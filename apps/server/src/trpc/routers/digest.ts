import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { TRPCError } from "@trpc/server";

export const digestRouter = router({
	listForUser: protectedProcedure
		.input(z.object({ profileId: z.number().optional() }).optional())
		.query(async ({ ctx, input }) => {
			const userId = ctx.user.id;
			let query = ctx.db
				.selectFrom("digest as d")
				.leftJoin("interest_profile as p", "p.id", "d.profile_id")
				.select([
					"d.id",
					"d.run_id",
					"d.user_id",
					"d.profile_id",
					"d.executive_summary",
					"d.key_takeaways",
					"d.why_it_matters",
					"d.key_quotes",
					"d.created_at",
					"p.name as profile_name",
				])
				.where("d.user_id", "=", userId);

			if (input?.profileId) {
				query = query.where("d.profile_id", "=", input.profileId);
			}

			const digests = await query.orderBy("d.created_at", "desc").execute();

			return digests.map((d) => ({
				...d,
				key_takeaways: JSON.parse(d.key_takeaways || "[]"),
				key_quotes: JSON.parse(d.key_quotes || "[]"),
			}));
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.number().int() }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.user.id;
			const digest = await ctx.db
				.selectFrom("digest as d")
				.leftJoin("interest_profile as p", "p.id", "d.profile_id")
				.select([
					"d.id",
					"d.run_id",
					"d.user_id",
					"d.profile_id",
					"d.executive_summary",
					"d.key_takeaways",
					"d.why_it_matters",
					"d.key_quotes",
					"d.created_at",
					"p.name as profile_name",
				])
				.where("d.id", "=", input.id)
				.where("d.user_id", "=", userId)
				.executeTakeFirst();

			if (!digest) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Digest #${input.id} not found`,
				});
			}

			const digestClusters = await ctx.db
				.selectFrom("digest_cluster")
				.selectAll()
				.where("digest_id", "=", digest.id)
				.execute();

			const citations = await ctx.db
				.selectFrom("citation")
				.innerJoin("article", "article.id", "citation.article_id")
				.select([
					"citation.id as id",
					"citation.digest_id as digest_id",
					"citation.digest_cluster_id as digest_cluster_id",
					"citation.article_id as article_id",
					"citation.citation_key as citation_key",
					"article.title as article_title",
					"article.url as article_url",
					"article.author as article_author",
					"article.publish_date as article_publish_date",
				])
				.where("citation.digest_id", "=", digest.id)
				.execute();

			return {
				...digest,
				key_takeaways: JSON.parse(digest.key_takeaways || "[]"),
				key_quotes: JSON.parse(digest.key_quotes || "[]"),
				clusters: digestClusters.map((dc) => ({
					...dc,
					perspectives: JSON.parse(dc.perspectives || "[]"),
					timeline: JSON.parse(dc.timeline || "[]"),
				})),
				citations,
			};
		}),
});
