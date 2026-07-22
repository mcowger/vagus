import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { serializeFloat32 } from "../../embeddings/types";
import { getEmbedder } from "../../queue/embed-job";

function normalizeArrayInput(input: string[] | string | undefined | null): string[] {
	if (!input) return [];
	if (Array.isArray(input)) return input.map((s) => s.trim()).filter(Boolean);
	const trimmed = input.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
		} catch {
			// fallback to split
		}
	}
	return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseArray(val: string | string[] | null | undefined): string[] {
	if (!val) return [];
	if (Array.isArray(val)) return val;
	try {
		const parsed = JSON.parse(val);
		if (Array.isArray(parsed)) return parsed.map(String);
	} catch {
		return val.split(",").map((s) => s.trim()).filter(Boolean);
	}
	return [];
}

const arrayOrString = z.union([z.array(z.string()), z.string()]);

export const profilesRouter = router({
	getProfile: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;
		let profile = await ctx.db
			.selectFrom("interest_profile")
			.selectAll()
			.where("user_id", "=", userId)
			.executeTakeFirst();

		if (!profile) {
			const now = new Date().toISOString();
			const defaultName = "Default Profile";
			const embedder = await getEmbedder(ctx.db);
			const vec = await embedder.embedText(defaultName);
			const embedding = serializeFloat32(vec);

			profile = await ctx.db
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

		return profile;
	}),

	updateProfile: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).optional(),
				keywords: arrayOrString.optional(),
				topics: arrayOrString.optional(),
				entities: arrayOrString.optional(),
				include_rules: arrayOrString.optional(),
				exclude_rules: arrayOrString.optional(),
				similarity_threshold: z.number().min(0).max(1).optional(),
				max_cluster_cap: z.number().int().min(1).optional(),
				ntfy_topic: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			let existing = await ctx.db
				.selectFrom("interest_profile")
				.selectAll()
				.where("user_id", "=", userId)
				.executeTakeFirst();

			const now = new Date().toISOString();

			if (!existing) {
				const embedder = await getEmbedder(ctx.db);
				const defaultVec = await embedder.embedText(input.name || "Default Profile");
				existing = await ctx.db
					.insertInto("interest_profile")
					.values({
						user_id: userId,
						name: input.name || "Default Profile",
						keywords: JSON.stringify([]),
						topics: JSON.stringify([]),
						entities: JSON.stringify([]),
						include_rules: JSON.stringify([]),
						exclude_rules: JSON.stringify([]),
						profile_embedding: serializeFloat32(defaultVec),
						similarity_threshold: 0.65,
						max_cluster_cap: 10,
						ntfy_topic: null,
						created_at: now,
						updated_at: now,
					})
					.returningAll()
					.executeTakeFirstOrThrow();
			}

			const name = input.name !== undefined ? input.name : existing.name;

			const kwList = input.keywords !== undefined
				? normalizeArrayInput(input.keywords)
				: parseArray(existing.keywords);

			const topicList = input.topics !== undefined
				? normalizeArrayInput(input.topics)
				: parseArray(existing.topics);

			const entityList = input.entities !== undefined
				? normalizeArrayInput(input.entities)
				: parseArray(existing.entities);

			const incList = input.include_rules !== undefined
				? normalizeArrayInput(input.include_rules)
				: parseArray(existing.include_rules);

			const excList = input.exclude_rules !== undefined
				? normalizeArrayInput(input.exclude_rules)
				: parseArray(existing.exclude_rules);

			const similarityThreshold = input.similarity_threshold !== undefined
				? input.similarity_threshold
				: existing.similarity_threshold;

			const maxClusterCap = input.max_cluster_cap !== undefined
				? input.max_cluster_cap
				: existing.max_cluster_cap;

			const ntfyTopic = input.ntfy_topic !== undefined
				? input.ntfy_topic
				: existing.ntfy_topic;

			const textToEmbed = [
				name,
				...kwList,
				...topicList,
				...entityList,
				...incList,
				...excList,
			].filter(Boolean).join(" ");

			const embedder = await getEmbedder(ctx.db);
			const vec = await embedder.embedText(textToEmbed || name || "default");
			const embedding = serializeFloat32(vec);

			await ctx.db
				.updateTable("interest_profile")
				.set({
					name,
					keywords: JSON.stringify(kwList),
					topics: JSON.stringify(topicList),
					entities: JSON.stringify(entityList),
					include_rules: JSON.stringify(incList),
					exclude_rules: JSON.stringify(excList),
					similarity_threshold: similarityThreshold,
					max_cluster_cap: maxClusterCap,
					ntfy_topic: ntfyTopic,
					profile_embedding: embedding,
					updated_at: now,
				})
				.where("user_id", "=", userId)
				.execute();

			const updated = await ctx.db
				.selectFrom("interest_profile")
				.selectAll()
				.where("user_id", "=", userId)
				.executeTakeFirstOrThrow();

			return updated;
		}),
});
