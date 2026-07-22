import type { Kysely, Selectable } from "kysely";
import type { ClusterArticleTable, ClusterTable, Database } from "../db/schema";
import { deserializeFloat32 } from "../embeddings/types";
import { InMemoryVectorIndex } from "../embeddings/vector-index";

export interface ClusterRunOptions {
	threshold?: number;
}

export interface ClusterRunResult {
	clusters: Selectable<ClusterTable>[];
	clusterArticles: Selectable<ClusterArticleTable>[];
}

export function tokenizeTitle(title: string): Set<string> {
	if (!title) return new Set();
	const tokens = title
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length > 0);
	return new Set(tokens);
}

export function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
	if (setA.size === 0 || setB.size === 0) return 0.0;
	let intersection = 0;
	for (const token of setA) {
		if (setB.has(token)) {
			intersection++;
		}
	}
	const union = setA.size + setB.size - intersection;
	if (union === 0) return 0.0;
	return intersection / union;
}

export function selectPrimaryArticle<T extends { id: number; publish_date: string | null; content: string | null }>(
	articles: T[],
): T {
	if (articles.length === 0) {
		throw new Error("Cannot select primary article from empty array");
	}

	const sorted = [...articles].sort((a, b) => {
		// 1. Earliest publish date
		if (a.publish_date && b.publish_date) {
			const timeA = new Date(a.publish_date).getTime();
			const timeB = new Date(b.publish_date).getTime();
			if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
				return timeA - timeB;
			}
		} else if (a.publish_date && !b.publish_date) {
			return -1;
		} else if (!a.publish_date && b.publish_date) {
			return 1;
		}

		// 2. Longest content
		const lenA = a.content ? a.content.length : 0;
		const lenB = b.content ? b.content.length : 0;
		if (lenA !== lenB) {
			return lenB - lenA; // descending content length
		}

		// 3. Fallback to smallest ID for deterministic tie-breaking
		return a.id - b.id;
	});

	return sorted[0];
}

class UnionFind {
	private parent = new Map<number, number>();

	find(i: number): number {
		if (!this.parent.has(i)) {
			this.parent.set(i, i);
			return i;
		}
		let root = i;
		while (root !== this.parent.get(root)!) {
			root = this.parent.get(root)!;
		}
		let curr = i;
		while (curr !== root) {
			const nxt = this.parent.get(curr)!;
			this.parent.set(curr, root);
			curr = nxt;
		}
		return root;
	}

	union(i: number, j: number): void {
		const rootI = this.find(i);
		const rootJ = this.find(j);
		if (rootI !== rootJ) {
			this.parent.set(rootI, rootJ);
		}
	}
}

export async function clusterRunArticles(
	db: Kysely<Database>,
	runId: number,
	options?: ClusterRunOptions,
): Promise<ClusterRunResult> {
	const threshold = options?.threshold ?? 0.8;

	// Fetch all articles
	const articleRows = await db.selectFrom("article").selectAll().execute();

	if (articleRows.length === 0) {
		return { clusters: [], clusterArticles: [] };
	}

	const articleIds = articleRows.map((a) => a.id);
	const embeddingRows = await db
		.selectFrom("article_embedding")
		.selectAll()
		.where("article_id", "in", articleIds)
		.execute();

	const embeddingMap = new Map<number, Float32Array>();
	for (const row of embeddingRows) {
		try {
			const vec = deserializeFloat32(row.embedding);
			embeddingMap.set(row.article_id, vec);
		} catch {
			// ignore malformed embeddings
		}
	}

	const vectorIndex = new InMemoryVectorIndex();
	const titleTokenMap = new Map<number, Set<string>>();

	const articlesWithParsed = articleRows.map((art) => {
		const vec = embeddingMap.get(art.id) ?? null;
		if (vec) {
			vectorIndex.add(art.id, vec);
		}
		const tokens = tokenizeTitle(art.title);
		titleTokenMap.set(art.id, tokens);
		return {
			...art,
			embedding: vec,
		};
	});

	const uf = new UnionFind();

	// Ensure all articles are initialized in UnionFind
	for (const art of articlesWithParsed) {
		uf.find(art.id);
	}

	// 1. Cosine similarity matching via InMemoryVectorIndex
	for (const art of articlesWithParsed) {
		if (art.embedding) {
			const searchResults = vectorIndex.search(
				art.embedding,
				articlesWithParsed.length,
				threshold,
			);
			for (const res of searchResults) {
				uf.union(art.id, res.id);
			}
		}
	}

	// 2. Lexical fallback (Jaccard similarity on title tokens) for articles without embeddings
	for (let i = 0; i < articlesWithParsed.length; i++) {
		const a1 = articlesWithParsed[i];
		const tokens1 = titleTokenMap.get(a1.id)!;

		for (let j = i + 1; j < articlesWithParsed.length; j++) {
			const a2 = articlesWithParsed[j];

			// If either article lacks an embedding, fallback to Jaccard similarity
			if (!a1.embedding || !a2.embedding) {
				const tokens2 = titleTokenMap.get(a2.id)!;
				const sim = computeJaccardSimilarity(tokens1, tokens2);
				if (sim >= threshold) {
					uf.union(a1.id, a2.id);
				}
			}
		}
	}

	// Group articles by root parent
	const groupsMap = new Map<number, typeof articlesWithParsed>();
	for (const art of articlesWithParsed) {
		const root = uf.find(art.id);
		const group = groupsMap.get(root) ?? [];
		group.push(art);
		groupsMap.set(root, group);
	}

	// Write clusters and cluster_articles to DB in a transaction
	return await db.transaction().execute(async (trx) => {
		// Clean up existing clusters for this runId for idempotency
		await trx.deleteFrom("cluster").where("run_id", "=", runId).execute();

		const createdClusters: Selectable<ClusterTable>[] = [];
		const createdClusterArticles: Selectable<ClusterArticleTable>[] = [];

		for (const group of groupsMap.values()) {
			const primary = selectPrimaryArticle(group);

			const clusterRow = await trx
				.insertInto("cluster")
				.values({
					run_id: runId,
					primary_article_id: primary.id,
					summary_title: primary.title,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			createdClusters.push(clusterRow);

			for (const art of group) {
				const isPrimary = art.id === primary.id ? 1 : 0;
				const caRow = await trx
					.insertInto("cluster_article")
					.values({
						cluster_id: clusterRow.id,
						article_id: art.id,
						is_primary: isPrimary,
					})
					.returningAll()
					.executeTakeFirstOrThrow();

				createdClusterArticles.push(caRow);
			}
		}

		return {
			clusters: createdClusters,
			clusterArticles: createdClusterArticles,
		};
	});
}
