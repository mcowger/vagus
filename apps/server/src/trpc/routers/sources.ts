import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const sourcesRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;
		// Return global sources (owner_user_id IS NULL) + user's private sources
		return await ctx.db
			.selectFrom("source")
			.selectAll()
			.where((eb) =>
				eb.or([
					eb("owner_user_id", "is", null),
					eb("owner_user_id", "=", userId),
				]),
			)
			.orderBy("id", "desc")
			.execute();
	}),

	create: protectedProcedure
		.input(
			z.object({
				type: z.enum(["rss", "brave-news", "hackernews", "github-trending", "scrape"]),
				name: z.string().min(1),
				url: z.string().nullable().optional(),
				config: z.string().nullable().optional(),
				enabled: z.boolean().optional().default(true),
				isPrivate: z.boolean().optional().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const ownerUserId = input.isPrivate ? ctx.user.id : null;

			// Non-admin users can only create private sources
			if (!input.isPrivate && ctx.user.role !== "admin") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only admins can create global public sources",
				});
			}

			const now = new Date().toISOString();
			const inserted = await ctx.db
				.insertInto("source")
				.values({
					type: input.type,
					name: input.name,
					url: input.url ?? null,
					config: input.config ?? null,
					enabled: input.enabled ? 1 : 0,
					owner_user_id: ownerUserId,
					created_at: now,
					updated_at: now,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			return inserted;
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().min(1).optional(),
				url: z.string().nullable().optional(),
				config: z.string().nullable().optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const source = await ctx.db
				.selectFrom("source")
				.selectAll()
				.where("id", "=", input.id)
				.executeTakeFirst();

			if (!source) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Source not found" });
			}

			if (source.owner_user_id !== null && source.owner_user_id !== ctx.user.id && ctx.user.role !== "admin") {
				throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to update this source" });
			}

			const now = new Date().toISOString();
			await ctx.db
				.updateTable("source")
				.set({
					name: input.name !== undefined ? input.name : source.name,
					url: input.url !== undefined ? input.url : source.url,
					config: input.config !== undefined ? input.config : source.config,
					enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : source.enabled,
					updated_at: now,
				})
				.where("id", "=", input.id)
				.execute();

			return { success: true };
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const source = await ctx.db
				.selectFrom("source")
				.selectAll()
				.where("id", "=", input.id)
				.executeTakeFirst();

			if (!source) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Source not found" });
			}

			if (source.owner_user_id !== null && source.owner_user_id !== ctx.user.id && ctx.user.role !== "admin") {
				throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to delete this source" });
			}

			await ctx.db.deleteFrom("source").where("id", "=", input.id).execute();
			return { success: true };
		}),
});
