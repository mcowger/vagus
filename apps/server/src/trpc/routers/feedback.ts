import { sql } from "kysely";
import { z } from "zod";
import { deserializeFloat32, serializeFloat32 } from "../../embeddings/types";
import { projectVectorToTaxonomy, TaxonomyProjectionResult } from "../../embeddings/taxonomy";
import { generateCompletion } from "../../llm";
import { protectedProcedure, router } from "../trpc";

/** Blends newVector into existingVector using Exponential Moving Average */
function blendVectors(
	existingVec: Float32Array | null,
	newVec: Float32Array,
	alpha = 0.25,
): Float32Array {
	if (!existingVec || existingVec.length !== newVec.length) {
		return newVec.slice();
	}
	const result = new Float32Array(existingVec.length);
	for (let i = 0; i < existingVec.length; i++) {
		result[i] = (1 - alpha) * existingVec[i] + alpha * newVec[i];
	}
	return result;
}

export const feedbackRouter = router({
	getUserSourceWeights: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;
		const rows = await ctx.db
			.selectFrom("user_source_weight as w")
			.innerJoin("source as s", "s.id", "w.source_id")
			.select(["w.source_id", "w.weight", "w.updated_at", "s.name as source_name"])
			.where("w.user_id", "=", userId)
			.execute();

		return rows;
	}),

	getFeedbackStats: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;

		const feedbackRows = await ctx.db
			.selectFrom("user_feedback")
			.selectAll()
			.where("user_id", "=", userId)
			.execute();

		const sourceWeights = await ctx.db
			.selectFrom("user_source_weight as w")
			.innerJoin("source as s", "s.id", "w.source_id")
			.select(["w.source_id", "w.weight", "w.updated_at", "s.name as source_name"])
			.where("w.user_id", "=", userId)
			.execute();

		// Fetch cluster feedback items with story titles
		const clusterFeedbackRows = await ctx.db
			.selectFrom("user_feedback as uf")
			.leftJoin("digest_cluster as dc", (join) =>
				join.onRef("dc.id", "=", sql`CAST(uf.target_id AS INTEGER)`),
			)
			.leftJoin("cluster as c", "c.id", "dc.cluster_id")
			.select([
				"uf.id",
				"uf.target_id",
				"uf.vote",
				"uf.topic_category",
				"uf.updated_at",
				"dc.title as digest_title",
				"c.summary_title as cluster_title",
			])
			.where("uf.user_id", "=", userId)
			.where("uf.target_type", "=", "cluster")
			.where("uf.vote", "!=", 0)
			.execute();

		const profile = await ctx.db
			.selectFrom("interest_profile")
			.select(["positive_embedding", "negative_embedding"])
			.where("user_id", "=", userId)
			.executeTakeFirst();

		let positiveProjections: TaxonomyProjectionResult[] = [];
		let negativeProjections: TaxonomyProjectionResult[] = [];

		if (profile?.positive_embedding && profile.positive_embedding.length > 0) {
			try {
				const posVec = deserializeFloat32(profile.positive_embedding);
				positiveProjections = await projectVectorToTaxonomy(ctx.db, posVec);
			} catch {}
		}

		if (profile?.negative_embedding && profile.negative_embedding.length > 0) {
			try {
				const negVec = deserializeFloat32(profile.negative_embedding);
				negativeProjections = await projectVectorToTaxonomy(ctx.db, negVec);
			} catch {}
		}

		const votesMap: Record<string, number> = {};
		for (const row of feedbackRows) {
			const key = `${row.target_type}:${row.target_id}`;
			votesMap[key] = row.vote;
		}

		return {
			feedback: votesMap,
			sourceWeights,
			clusterFeedback: clusterFeedbackRows.map((r) => ({
				id: r.id,
				clusterId: r.target_id,
				title: r.digest_title || r.cluster_title || `Story Cluster #${r.target_id}`,
				vote: r.vote,
				topicCategory: r.topic_category,
				updatedAt: r.updated_at,
			})),
			hasPositiveVector: !!(profile?.positive_embedding && profile.positive_embedding.length > 0),
			hasNegativeVector: !!(profile?.negative_embedding && profile.negative_embedding.length > 0),
			positiveProjections,
			negativeProjections,
		};
	}),

	voteSource: protectedProcedure
		.input(
			z.object({
				sourceId: z.number(),
				vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;
			const now = new Date().toISOString();

			// 1. Record feedback event in user_feedback
			const existingFeedback = await ctx.db
				.selectFrom("user_feedback")
				.select("id")
				.where("user_id", "=", userId)
				.where("target_type", "=", "source")
				.where("target_id", "=", String(input.sourceId))
				.executeTakeFirst();

			if (existingFeedback) {
				await ctx.db
					.updateTable("user_feedback")
					.set({ vote: input.vote, updated_at: now })
					.where("id", "=", existingFeedback.id)
					.execute();
			} else {
				await ctx.db
					.insertInto("user_feedback")
					.values({
						user_id: userId,
						target_type: "source",
						target_id: String(input.sourceId),
						vote: input.vote,
						created_at: now,
						updated_at: now,
					})
					.execute();
			}

			// 2. Update calculated weight in user_source_weight
			const existingWeight = await ctx.db
				.selectFrom("user_source_weight")
				.select(["id", "weight"])
				.where("user_id", "=", userId)
				.where("source_id", "=", input.sourceId)
				.executeTakeFirst();

			let newWeight = 1.0;
			if (input.vote === 1) {
				newWeight = Math.min(2.0, (existingWeight?.weight ?? 1.0) + 0.3);
			} else if (input.vote === -1) {
				newWeight = Math.max(0.0, (existingWeight?.weight ?? 1.0) - 0.3);
			} else {
				newWeight = 1.0;
			}

			if (existingWeight) {
				await ctx.db
					.updateTable("user_source_weight")
					.set({ weight: newWeight, updated_at: now })
					.where("id", "=", existingWeight.id)
					.execute();
			} else {
				await ctx.db
					.insertInto("user_source_weight")
					.values({
						user_id: userId,
						source_id: input.sourceId,
						weight: newWeight,
						updated_at: now,
					})
					.execute();
			}

			return { success: true, newWeight };
		}),

	voteCluster: protectedProcedure
		.input(
			z.object({
				clusterId: z.number(),
				vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;
			const now = new Date().toISOString();

			// 1. Fetch cluster details & embedding
			const cluster = await ctx.db
				.selectFrom("digest_cluster as dc")
				.leftJoin("cluster as c", "c.id", "dc.cluster_id")
				.leftJoin("article_embedding as ae", "ae.article_id", "c.primary_article_id")
				.select([
					"dc.title as title",
					"dc.summary as summary",
					"c.primary_article_id",
					"ae.embedding as article_embedding",
				])
				.where("dc.id", "=", input.clusterId)
				.executeTakeFirst();

			// 2. Extract LLM Topic Category label if voting
			let topicCategory: string | null = null;
			if (cluster?.title && input.vote !== 0) {
				try {
					const categoryPrompt = `Classify this news story into a concise 2-4 word high-level topic category (e.g. 'Personal Finance & Banking', 'Cybersecurity & Infrastructure', 'Smart Home & Hardware', 'Artificial Intelligence', 'Legal & Public Policy').

Title: ${cluster.title}
Summary: ${(cluster.summary || "").slice(0, 200)}

Respond ONLY with the 2-4 word topic category name.`;

					const completion = await generateCompletion("stage_a_bullet", categoryPrompt, { db: ctx.db });
					if (completion.text?.trim()) {
						topicCategory = completion.text.trim().replace(/^["']|["']$/g, "");
					}
				} catch {
					topicCategory = cluster.title.split(":")[0]?.trim() || "General Topic";
				}
			}

			// 3. Record feedback in user_feedback
			const existingFeedback = await ctx.db
				.selectFrom("user_feedback")
				.select(["id", "topic_category"])
				.where("user_id", "=", userId)
				.where("target_type", "=", "cluster")
				.where("target_id", "=", String(input.clusterId))
				.executeTakeFirst();

			if (existingFeedback) {
				await ctx.db
					.updateTable("user_feedback")
					.set({
						vote: input.vote,
						topic_category: topicCategory ?? existingFeedback.topic_category,
						updated_at: now,
					})
					.where("id", "=", existingFeedback.id)
					.execute();
			} else {
				await ctx.db
					.insertInto("user_feedback")
					.values({
						user_id: userId,
						target_type: "cluster",
						target_id: String(input.clusterId),
						vote: input.vote,
						topic_category: topicCategory,
						created_at: now,
						updated_at: now,
					})
					.execute();
			}

			if (cluster?.article_embedding) {
				try {
					const clusterVec = deserializeFloat32(cluster.article_embedding);
					const profile = await ctx.db
						.selectFrom("interest_profile")
						.select(["id", "positive_embedding", "negative_embedding"])
						.where("user_id", "=", userId)
						.executeTakeFirst();

					if (profile) {
						if (input.vote === 1) {
							const existingPos = profile.positive_embedding ? deserializeFloat32(profile.positive_embedding) : null;
							const updatedPos = blendVectors(existingPos, clusterVec, 0.25);
							await ctx.db
								.updateTable("interest_profile")
								.set({ positive_embedding: serializeFloat32(updatedPos), updated_at: now })
								.where("id", "=", profile.id)
								.execute();
						} else if (input.vote === -1) {
							const existingNeg = profile.negative_embedding ? deserializeFloat32(profile.negative_embedding) : null;
							const updatedNeg = blendVectors(existingNeg, clusterVec, 0.25);
							await ctx.db
								.updateTable("interest_profile")
								.set({ negative_embedding: serializeFloat32(updatedNeg), updated_at: now })
								.where("id", "=", profile.id)
								.execute();
						}
					}
				} catch {
					// Ignore vector deserialization errors
				}
			}

			return { success: true };
		}),
});
