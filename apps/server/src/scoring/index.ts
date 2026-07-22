import type { Kysely } from "kysely";
import { getDb, type Database } from "../db";
import { deserializeFloat32, serializeFloat32, cosineSimilarity } from "../embeddings/types";
import { getEmbedder } from "../queue/embed-job";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { getPromptTemplates, renderPrompt } from "../prompts/defaults";

function parseJsonArray(input: string | null | undefined): string[] {
	if (!input) return [];
	try {
		const parsed = JSON.parse(input);
		if (Array.isArray(parsed)) {
			return parsed
				.map((item) => String(item).trim())
				.filter((item) => item.length > 0);
		}
	} catch {
		// Ignore invalid JSON
	}
	return [];
}

export interface ScoreClusterResult {
	clusterId: number;
	score: number;
	reason: string;
}

export async function scoreClustersForUser(
	db: Kysely<Database> | null | undefined,
	runId: number,
	userId: string,
): Promise<ScoreClusterResult[]> {
	const database = getDb(db);

	// 1. Fetch user's interest_profile
	let profile = await database
		.selectFrom("interest_profile")
		.selectAll()
		.where("user_id", "=", userId)
		.executeTakeFirst();

	if (!profile) {
		const now = new Date().toISOString();
		const defaultName = "Default Profile";
		let embedding: Uint8Array | null = null;
		try {
			const embedder = await getEmbedder(database);
			const vec = await embedder.embedText(defaultName);
			embedding = serializeFloat32(vec);
		} catch {}

		profile = await database
			.insertInto("interest_profile")
			.values({
				user_id: userId,
				name: defaultName,
				keywords: JSON.stringify([]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: embedding,
				similarity_threshold: 0.65,
				max_cluster_cap: 10,
				ntfy_topic: null,
				created_at: now,
				updated_at: now,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	const keywords = parseJsonArray(profile.keywords);
	const topics = parseJsonArray(profile.topics);
	const entities = parseJsonArray(profile.entities);
	const includeRules = parseJsonArray(profile.include_rules);
	const excludeRules = parseJsonArray(profile.exclude_rules);

	let profileVector: Float32Array | null = null;
	if (profile.profile_embedding && profile.profile_embedding.length > 0) {
		try {
			profileVector = deserializeFloat32(profile.profile_embedding);
		} catch (err) {
			log.warn("Failed to deserialize profile_embedding", { userId, error: String(err) });
		}
	}

	let positiveVector: Float32Array | null = null;
	if (profile.positive_embedding && profile.positive_embedding.length > 0) {
		try {
			positiveVector = deserializeFloat32(profile.positive_embedding);
		} catch {}
	}

	let negativeVector: Float32Array | null = null;
	if (profile.negative_embedding && profile.negative_embedding.length > 0) {
		try {
			negativeVector = deserializeFloat32(profile.negative_embedding);
		} catch {}
	}

	// Fetch user source weight overrides
	const userSourceWeightRows = await database
		.selectFrom("user_source_weight")
		.select(["source_id", "weight"])
		.where("user_id", "=", userId)
		.execute();

	const sourceWeightMap = new Map<number, number>();
	for (const row of userSourceWeightRows) {
		sourceWeightMap.set(row.source_id, row.weight);
	}

	// 2. Fetch all clusters and primary articles for runId
	const clusterRows = await database
		.selectFrom("cluster as c")
		.innerJoin("article as a", "a.id", "c.primary_article_id")
		.leftJoin("article_embedding as ae", "ae.article_id", "a.id")
		.select([
			"c.id as cluster_id",
			"c.summary_title as summary_title",
			"a.id as article_id",
			"a.source_id as source_id",
			"a.title as title",
			"a.content as content",
			"a.stage_a_bullet as stage_a_bullet",
			"ae.embedding as article_embedding",
		])
		.where("c.run_id", "=", runId)
		.execute();

	if (clusterRows.length === 0) {
		log.info("No clusters found for runId", { runId });
		await database
			.deleteFrom("user_selected_cluster")
			.where("run_id", "=", runId)
			.where("user_id", "=", userId)
			.execute();
		return [];
	}

	// Fetch articles previously delivered in prior digests for this user
	const previousDigestCitations = await database
		.selectFrom("citation")
		.innerJoin("digest", "digest.id", "citation.digest_id")
		.select("citation.article_id")
		.where("digest.user_id", "=", userId)
		.execute();

	const previousDigestClusterArticles = await database
		.selectFrom("digest")
		.innerJoin("digest_cluster", "digest_cluster.digest_id", "digest.id")
		.innerJoin("cluster_article", "cluster_article.cluster_id", "digest_cluster.cluster_id")
		.select("cluster_article.article_id")
		.where("digest.user_id", "=", userId)
		.execute();

	const seenArticleIds = new Set<number>();
	for (const r of previousDigestCitations) {
		if (r.article_id) seenArticleIds.add(r.article_id);
	}
	for (const r of previousDigestClusterArticles) {
		if (r.article_id) seenArticleIds.add(r.article_id);
	}

	// Fetch cluster_article mappings for current run clusters
	const clusterIds = clusterRows.map((r) => r.cluster_id);
	const clusterArticleRows = await database
		.selectFrom("cluster_article")
		.select(["cluster_id", "article_id"])
		.where("cluster_id", "in", clusterIds)
		.execute();

	const clusterArticlesMap = new Map<number, number[]>();
	for (const row of clusterArticleRows) {
		const list = clusterArticlesMap.get(row.cluster_id) ?? [];
		list.push(row.article_id);
		clusterArticlesMap.set(row.cluster_id, list);
	}

	const scoredClusters: ScoreClusterResult[] = [];

	// 3. Score each cluster
	for (const row of clusterRows) {
		const articleIdsInCluster = clusterArticlesMap.get(row.cluster_id) ?? [row.article_id];
		const newArticlesInCluster = articleIdsInCluster.filter((id) => !seenArticleIds.has(id));

		// Recency / History Deduplication: Skip cluster if all articles were already delivered in a previous digest
		if (seenArticleIds.size > 0 && newArticlesInCluster.length === 0) {
			scoredClusters.push({
				clusterId: row.cluster_id,
				score: 0,
				reason: "Already delivered in previous digest for user",
			});
			continue;
		}
		const title = row.title || "";
		const content = row.content || row.stage_a_bullet || "";
		const summaryTitle = row.summary_title || "";
		const fullText = `${title} ${summaryTitle} ${content}`.trim();
		const lowerFullText = fullText.toLowerCase();
		const lowerTitle = title.toLowerCase();

		// Check hard include rules first
		if (includeRules.length > 0) {
			const hasIncludeMatch = includeRules.some((rule) =>
				lowerFullText.includes(rule.toLowerCase()),
			);
			if (!hasIncludeMatch) {
				// Score 0 due to include rule mismatch
				scoredClusters.push({
					clusterId: row.cluster_id,
					score: 0,
					reason: "Failed hard include rules",
				});
				continue;
			}
		}

		// Check hard exclude rules
		if (excludeRules.length > 0) {
			const hasExcludeMatch = excludeRules.some((rule) =>
				lowerFullText.includes(rule.toLowerCase()),
			);
			if (hasExcludeMatch) {
				// Score 0 due to exclude rule match
				scoredClusters.push({
					clusterId: row.cluster_id,
					score: 0,
					reason: "Matched hard exclude rule",
				});
				continue;
			}
		}

		// Calculate Base Score
		let baseScore = 0;
		let articleVector: Float32Array | null = null;
		if (row.article_embedding && row.article_embedding.length > 0) {
			try {
				articleVector = deserializeFloat32(row.article_embedding);
			} catch (err) {
				log.warn("Failed to deserialize article_embedding", {
					articleId: row.article_id,
					error: String(err),
				});
			}
		}

		if (profileVector && articleVector && profileVector.length !== articleVector.length) {
			try {
				const embedder = await getEmbedder(database);
				const textToEmbed = [
					profile.name,
					...keywords,
					...topics,
					...entities,
					...includeRules,
					...excludeRules,
				].filter(Boolean).join(" ");

				profileVector = await embedder.embedText(textToEmbed || profile.name || "default");
				await database
					.updateTable("interest_profile")
					.set({
						profile_embedding: serializeFloat32(profileVector),
						updated_at: new Date().toISOString(),
					})
					.where("user_id", "=", userId)
					.execute();
			} catch (err) {
				log.warn("Failed to re-embed interest profile with matching dimension", { userId, error: String(err) });
			}
		}

		if (profileVector && articleVector) {
			const sim = cosineSimilarity(profileVector, articleVector);
			baseScore = Math.max(0, sim);
		} else {
			// Fallback: title keyword overlap
			const terms = keywords.length > 0 ? keywords : [...topics, ...entities];
			if (terms.length > 0) {
				const matches = terms.filter((term) =>
					lowerTitle.includes(term.toLowerCase()),
				).length;
				baseScore = matches / terms.length;
			} else if (!profileVector) {
				// No interest criteria specified at all (neither vector nor terms):
				// Default baseline score (0.5) so all clusters qualify in broad curator mode
				baseScore = 0.5;
			} else {
				baseScore = 0;
			}
		}

		// Calculate Keyword / Entity Boost (+0.1 for each matching keyword/entity)
		let boost = 0;
		const boostTerms = [...keywords, ...entities];
		const matchedBoostTerms: string[] = [];
		for (const term of boostTerms) {
			if (lowerFullText.includes(term.toLowerCase())) {
				boost += 0.1;
				matchedBoostTerms.push(term);
			}
		}

		// Source Weighting Check
		const sourceWeight = row.source_id ? (sourceWeightMap.get(row.source_id) ?? 1.0) : 1.0;
		if (sourceWeight <= 0.1) {
			scoredClusters.push({
				clusterId: row.cluster_id,
				score: 0,
				reason: "Source muted by user preference",
			});
			continue;
		}

		// Vector Preference Adjustments (Positive/Negative Feedback Vectors)
		let feedbackBoost = 0;
		if (articleVector && positiveVector && articleVector.length === positiveVector.length) {
			const posSim = cosineSimilarity(positiveVector, articleVector);
			if (posSim > 0.5) {
				feedbackBoost += posSim * 0.20;
			}
		}

		let feedbackPenalty = 0;
		if (articleVector && negativeVector && articleVector.length === negativeVector.length) {
			const negSim = cosineSimilarity(negativeVector, articleVector);
			if (negSim > 0.5) {
				feedbackPenalty += negSim * 0.30;
			}
		}

		let prelimScore = (baseScore + boost + feedbackBoost - feedbackPenalty) * sourceWeight;
		prelimScore = Math.min(1.0, Math.max(0.0, prelimScore));

		let finalScore = prelimScore;
		let reason = `Base score: ${baseScore.toFixed(2)}, Boost: +${boost.toFixed(
			2,
		)} (${matchedBoostTerms.join(", ") || "none"})`;

		// LLM Tiebreaker for borderline clusters (score between 0.5 and 0.7)
		if (prelimScore >= 0.5 && prelimScore <= 0.7) {
			const profileText = `Keywords: ${keywords.join(", ")}\nTopics: ${topics.join(", ")}\nEntities: ${entities.join(", ")}`;
			const clusterTitle = title;
			const clusterSummary = summaryTitle || content.slice(0, 300);

			try {
				const { systemPrompt, userPromptTemplate } = await getPromptTemplates(database, "scoring_tiebreaker");
				const tiebreakerPrompt = renderPrompt(userPromptTemplate, {
					profileText,
					title: clusterTitle,
					summary: clusterSummary,
				});

				const completion = await generateCompletion("scoring_tiebreaker", tiebreakerPrompt, {
					runId,
					db: database,
					systemPrompt,
				});

				const llmText = completion.text;
				const upperLlm = llmText.toUpperCase();

				if (upperLlm.includes("IRRELEVANT") || upperLlm.includes("NO")) {
					finalScore = Math.max(0, prelimScore - 0.15);
					reason = `LLM tiebreaker (IRRELEVANT): ${llmText}`;
				} else if (upperLlm.includes("RELEVANT") || upperLlm.includes("YES")) {
					finalScore = Math.min(1.0, prelimScore + 0.15);
					reason = `LLM tiebreaker (RELEVANT): ${llmText}`;
				} else {
					reason = `LLM tiebreaker: ${llmText}`;
				}
			} catch (err) {
				log.warn("LLM tiebreaker failed, keeping preliminary score", {
					clusterId: row.cluster_id,
					error: String(err),
				});
			}
		}

		scoredClusters.push({
			clusterId: row.cluster_id,
			score: Number(finalScore.toFixed(4)),
			reason,
		});
	}

	// 4. Cap selection to top N clusters based on profile.max_cluster_cap
	const qualifiedClusters = scoredClusters.filter((c) => c.score > 0);
	qualifiedClusters.sort((a, b) => b.score - a.score || a.clusterId - b.clusterId);

	const cap = profile.max_cluster_cap > 0 ? profile.max_cluster_cap : 10;
	const selected = qualifiedClusters.slice(0, cap);

	// 5. Store selections in user_selected_cluster table
	await database
		.deleteFrom("user_selected_cluster")
		.where("run_id", "=", runId)
		.where("user_id", "=", userId)
		.execute();

	if (selected.length > 0) {
		const now = new Date().toISOString();
		await database
			.insertInto("user_selected_cluster")
			.values(
				selected.map((s) => ({
					run_id: runId,
					user_id: userId,
					cluster_id: s.clusterId,
					score: s.score,
					reason: s.reason,
					created_at: now,
				})),
			)
			.execute();
	}

	log.info("Scored clusters for user", {
		runId,
		userId,
		totalClusters: clusterRows.length,
		selectedCount: selected.length,
	});

	return selected;
}
