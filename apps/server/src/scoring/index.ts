import type { Kysely } from "kysely";
import { getDb, type Database } from "../db";
import { deserializeFloat32, cosineSimilarity } from "../embeddings/types";
import { generateCompletion } from "../llm";
import { log } from "../log";

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
	const profile = await database
		.selectFrom("interest_profile")
		.selectAll()
		.where("user_id", "=", userId)
		.executeTakeFirst();

	if (!profile) {
		log.warn("Interest profile not found for user", { userId, runId });
		return [];
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

	// 2. Fetch all clusters and primary articles for runId
	const clusterRows = await database
		.selectFrom("cluster as c")
		.innerJoin("article as a", "a.id", "c.primary_article_id")
		.leftJoin("article_embedding as ae", "ae.article_id", "a.id")
		.select([
			"c.id as cluster_id",
			"c.summary_title as summary_title",
			"a.id as article_id",
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

	const scoredClusters: ScoreClusterResult[] = [];

	// 3. Score each cluster
	for (const row of clusterRows) {
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

		let prelimScore = baseScore + boost;
		prelimScore = Math.min(1.0, Math.max(0.0, prelimScore));

		let finalScore = prelimScore;
		let reason = `Base score: ${baseScore.toFixed(2)}, Boost: +${boost.toFixed(
			2,
		)} (${matchedBoostTerms.join(", ") || "none"})`;

		// LLM Tiebreaker for borderline clusters (score between 0.5 and 0.7)
		if (prelimScore >= 0.5 && prelimScore <= 0.7) {
			const tiebreakerPrompt = `User Interest Profile:
Keywords: ${keywords.join(", ")}
Topics: ${topics.join(", ")}
Entities: ${entities.join(", ")}

Cluster Article:
Title: ${title}
Summary/Content: ${summaryTitle || content.slice(0, 300)}

Preliminary Score: ${prelimScore.toFixed(2)}

Determine whether this cluster is relevant to the user's interest profile. Reply with "RELEVANT" or "IRRELEVANT" and brief reasoning.`;

			try {
				const completion = await generateCompletion("scoring_tiebreaker", tiebreakerPrompt, {
					runId,
					db: database,
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
