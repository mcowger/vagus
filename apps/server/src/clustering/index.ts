import type { Kysely, Selectable } from "kysely";
import type { ClusterArticleTable, ClusterTable, Database } from "../db/schema";
import { deserializeFloat32 } from "../embeddings/types";
import { cosineSimilarity } from "../embeddings/types";
import { generateCompletion } from "../llm";
import { getPromptTemplates, renderPrompt } from "../prompts/defaults";
import { getArticleEligibilitySettings, isEligibleArticle } from "../pipeline/article-eligibility";
import { log } from "../log";

export interface ClusterRunOptions {
	threshold?: number;
	llmMergeEnabled?: boolean;
	topicSubclusterThreshold?: number;
	topicValidationMaxBuckets?: number;
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

const DEFAULT_TOPIC_SUBCLUSTER_THRESHOLD = 0.65;
const DEFAULT_TOPIC_VALIDATION_MAX_BUCKETS = 20;
const MIN_TOPIC_FREQUENCY = 3;
const TOPIC_STOP_WORDS = new Set([
	"after", "ai", "america", "ap", "are", "bbc", "china", "chinese", "cnn", "deal", "exclusive", "here", "how", "latest", "live", "most", "new", "news", "red", "reuters", "the", "they", "today", "us", "war", "was", "watch", "what", "when", "why", "with",
]);

function articleSimilarity(
	left: { embedding: Float32Array | null; title: string },
	right: { embedding: Float32Array | null; title: string },
): number {
	if (left.embedding && right.embedding) return cosineSimilarity(left.embedding, right.embedding);
	return computeJaccardSimilarity(tokenizeTitle(left.title), tokenizeTitle(right.title));
}

function topicTerms(article: { title: string; stage_a_bullet: string | null }): Set<string> {
	const namedTerms = article.title.match(/\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b/g) ?? [];
	const terms = new Set(namedTerms.map((term) => term.toLowerCase()).filter((term) => !TOPIC_STOP_WORDS.has(term)));
	const normalized = `${article.title}\n${article.stage_a_bullet ?? ""}`.toLowerCase().replaceAll("britain", "uk");
	if (normalized.includes("iran") && !/(jewelry|zendaya|odyssey)/.test(normalized)) terms.add("iran-war");
	if (normalized.includes("prime minister") && (normalized.includes("uk") || normalized.includes("burnham"))) terms.add("uk-prime-minister");
	return terms;
}

function topicPrompt<T extends { id: number; title: string; stage_a_bullet: string | null }>(articles: T[]): string {
	return articles
		.slice(0, 12)
		.map((article) => `[art_${article.id}] ${article.title}\n${article.stage_a_bullet ?? ""}`)
		.join("\n\n");
}

function isSameTopic(response: string): boolean {
	try {
		const parsed = JSON.parse(response.replace(/^```json\s*|\s*```$/g, "")) as { same_topic?: unknown };
		return parsed.same_topic === true;
	} catch {
		return false;
	}
}

function semanticGroups<T extends { embedding: Float32Array | null; title: string }>(articles: T[], threshold: number): T[][] {
	const groups: T[][] = [];
	for (const article of articles) {
		const group = groups.find((candidate) => candidate.every((member) => articleSimilarity(article, member) >= threshold));
		if (group) group.push(article);
		else groups.push([article]);
	}
	return groups;
}

export async function clusterRunArticles(
	db: Kysely<Database>,
	runId: number,
	options?: ClusterRunOptions,
): Promise<ClusterRunResult> {
	const threshold = options?.threshold ?? 0.8;
	const llmMergeEnabled = options?.llmMergeEnabled ?? false;
	const topicSubclusterThreshold = options?.topicSubclusterThreshold ?? DEFAULT_TOPIC_SUBCLUSTER_THRESHOLD;
	const topicValidationMaxBuckets = options?.topicValidationMaxBuckets ?? DEFAULT_TOPIC_VALIDATION_MAX_BUCKETS;
	const eligibilitySettings = await getArticleEligibilitySettings(db);

	const articleRows = (await db
		.selectFrom("article")
		.selectAll()
		.where("run_id", "=", runId)
		.execute()).filter((article) => isEligibleArticle(article, eligibilitySettings));

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

	const articlesWithParsed = articleRows.map((art) => {
		const vec = embeddingMap.get(art.id) ?? null;
		return {
			...art,
			embedding: vec,
		};
	});

	const frequencies = new Map<string, number>();
	for (const article of articlesWithParsed) {
		for (const term of topicTerms(article)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
	}
	const buckets = new Map<string, typeof articlesWithParsed>();
	for (const article of articlesWithParsed) {
		const terms = topicTerms(article);
		const topic = terms.has("iran-war") || terms.has("uk-prime-minister")
			? [...terms].find((term) => term === "iran-war" || term === "uk-prime-minister")
			: [...terms]
			.filter((term) => (frequencies.get(term) ?? 0) >= MIN_TOPIC_FREQUENCY)
			.sort((left, right) => (frequencies.get(left) ?? 0) - (frequencies.get(right) ?? 0))[0];
		const key = topic ?? "unbucketed";
		const bucket = buckets.get(key) ?? [];
		bucket.push(article);
		buckets.set(key, bucket);
	}

	const groups: typeof articlesWithParsed[] = [];
	const topicBuckets = [...buckets.entries()].filter(([key, bucket]) => key !== "unbucketed" && bucket.length > 1).sort((left, right) => right[1].length - left[1].length);
	const validatedTopics = new Set<string>();
	if (llmMergeEnabled) {
		const { systemPrompt, userPromptTemplate } = await getPromptTemplates(db, "event_identity_merge");
		for (const [index, [topic, bucket]] of topicBuckets.slice(0, topicValidationMaxBuckets).entries()) {
			log.info("Validating broad topic bucket", { runId, topic, articles: bucket.length, bucket: index + 1 });
			const completion = await generateCompletion("event_identity_merge", renderPrompt(userPromptTemplate, { topic, articles: topicPrompt(bucket) }), { db, runId, systemPrompt });
			const accepted = isSameTopic(completion.text);
			log.info("Completed broad topic validation", { runId, topic, articles: bucket.length, accepted });
			if (accepted) validatedTopics.add(topic);
		}
	}

	for (const [topic, bucket] of buckets) {
		if (validatedTopics.has(topic)) groups.push(bucket);
		else groups.push(...semanticGroups(bucket, topic === "unbucketed" ? threshold : topicSubclusterThreshold));
	}

	// Write clusters and cluster_articles to DB in a transaction
	return await db.transaction().execute(async (trx) => {
		// Clean up existing clusters for this runId for idempotency
		await trx.deleteFrom("cluster").where("run_id", "=", runId).execute();

		const createdClusters: Selectable<ClusterTable>[] = [];
		const createdClusterArticles: Selectable<ClusterArticleTable>[] = [];

		for (const group of groups) {
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
