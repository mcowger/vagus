import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { PROMPT_DEFINITIONS } from "../../prompts/defaults";
import { adminProcedure, router } from "../trpc";

export const settingsRouter = router({
	getSettings: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.selectFrom("system_setting")
			.selectAll()
			.execute();

		const settingsMap: Record<string, string> = {};
		for (const row of rows) {
			settingsMap[row.key] = row.value;
		}
		return settingsMap;
	}),

	getPrompts: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.selectFrom("system_setting")
			.selectAll()
			.where("key", "like", "prompt_%")
			.execute();

		const promptMap = new Map<string, string>();
		for (const row of rows) {
			promptMap.set(row.key, row.value);
		}

		return Object.values(PROMPT_DEFINITIONS).map((def) => {
			const sysKey = `prompt_${def.key}_system`;
			const userKey = `prompt_${def.key}_user`;

			const customSys = promptMap.get(sysKey);
			const customUser = promptMap.get(userKey);

			return {
				key: def.key,
				name: def.name,
				stage: def.stage,
				description: def.description,
				variables: def.variables,
				systemPrompt: customSys !== undefined ? customSys : def.defaultSystemPrompt,
				userPrompt: customUser !== undefined ? customUser : def.defaultUserPrompt,
				defaultSystemPrompt: def.defaultSystemPrompt,
				defaultUserPrompt: def.defaultUserPrompt,
				isCustomized: customSys !== undefined || customUser !== undefined,
			};
		});
	}),

	updatePrompt: adminProcedure
		.input(
			z.object({
				promptKey: z.string(),
				systemPrompt: z.string().optional(),
				userPrompt: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			const sysKey = `prompt_${input.promptKey}_system`;
			const userKey = `prompt_${input.promptKey}_user`;

			if (input.systemPrompt !== undefined) {
				const existingSys = await ctx.db
					.selectFrom("system_setting")
					.select("key")
					.where("key", "=", sysKey)
					.executeTakeFirst();

				if (existingSys) {
					await ctx.db
						.updateTable("system_setting")
						.set({ value: input.systemPrompt, updated_at: now })
						.where("key", "=", sysKey)
						.execute();
				} else {
					await ctx.db
						.insertInto("system_setting")
						.values({ key: sysKey, value: input.systemPrompt, updated_at: now })
						.execute();
				}
			}

			if (input.userPrompt !== undefined) {
				const existingUser = await ctx.db
					.selectFrom("system_setting")
					.select("key")
					.where("key", "=", userKey)
					.executeTakeFirst();

				if (existingUser) {
					await ctx.db
						.updateTable("system_setting")
						.set({ value: input.userPrompt, updated_at: now })
						.where("key", "=", userKey)
						.execute();
				} else {
					await ctx.db
						.insertInto("system_setting")
						.values({ key: userKey, value: input.userPrompt, updated_at: now })
						.execute();
				}
			}

			return { success: true };
		}),

	resetPrompt: adminProcedure
		.input(z.object({ promptKey: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const sysKey = `prompt_${input.promptKey}_system`;
			const userKey = `prompt_${input.promptKey}_user`;

			await ctx.db
				.deleteFrom("system_setting")
				.where("key", "in", [sysKey, userKey])
				.execute();

			return { success: true };
		}),

	resetPipelineData: adminProcedure
		.input(z.object({ level: z.enum(["clustering", "stage_a"]) }))
		.mutation(async ({ ctx, input }) => {
			const runningRun = await ctx.db
				.selectFrom("run")
				.select("id")
				.where("status", "=", "running")
				.executeTakeFirst();
			if (runningRun) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Wait for the active pipeline run to finish before resetting data.",
				});
			}

			await ctx.db.transaction().execute(async (trx) => {
				await trx.deleteFrom("citation").execute();
				await trx.deleteFrom("digest_cluster").execute();
				await trx.deleteFrom("digest").execute();
				await trx.deleteFrom("user_selected_cluster").execute();
				await trx.deleteFrom("cluster_article").execute();
				await trx.deleteFrom("cluster").execute();
				await trx.deleteFrom("llm_usage").execute();
				await trx.deleteFrom("run_stage").execute();
				await trx.deleteFrom("run").execute();
				const queueTables = await sql<{ name: string }>`
					SELECT name FROM sqlite_master
					WHERE type = 'table' AND name IN ('plainjob_jobs', 'plainjob_scheduled_jobs')
				`.execute(trx);
				if (queueTables.rows.some((table) => table.name === "plainjob_jobs")) {
					await sql`DELETE FROM plainjob_jobs`.execute(trx);
				}
				if (queueTables.rows.some((table) => table.name === "plainjob_scheduled_jobs")) {
					await sql`DELETE FROM plainjob_scheduled_jobs`.execute(trx);
				}
				if (input.level === "stage_a") {
					await trx.deleteFrom("article_embedding").execute();
					await trx
						.updateTable("article")
						.set({ run_id: null, stage_a_bullet: null })
						.execute();
				} else {
					await trx.updateTable("article").set({ run_id: null }).execute();
				}
			});

			return { success: true };
		}),

	updateSettings: adminProcedure
		.input(
			z.object({
				article_retention_days: z.union([z.string(), z.number()]).optional(),
				digest_retention_days: z.union([z.string(), z.number()]).optional(),
				ntfy_base_url: z.string().optional(),
				cron_schedule: z.string().optional(),
				app_base_url: z.string().optional(),
				worker_concurrency: z.union([z.string(), z.number()]).optional(),
				clustering_similarity_threshold: z.union([z.string(), z.number()]).optional(),
				clustering_llm_merge_min_similarity: z.union([z.string(), z.number()]).optional(),
				clustering_llm_merge_enabled: z.union([z.string(), z.boolean()]).optional(),
				clustering_llm_merge_max_candidates: z.union([z.string(), z.number()]).optional(),
				pipeline_article_max_age_hours: z.union([z.string(), z.number()]).optional(),
				pipeline_filter_feed_artifacts: z.union([z.string(), z.boolean()]).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			const entries = Object.entries(input);

			for (const [key, value] of entries) {
				if (value !== undefined) {
					const stringVal = String(value);
					const existing = await ctx.db
						.selectFrom("system_setting")
						.select("key")
						.where("key", "=", key)
						.executeTakeFirst();

					if (existing) {
						await ctx.db
							.updateTable("system_setting")
							.set({
								value: stringVal,
								updated_at: now,
							})
							.where("key", "=", key)
							.execute();
					} else {
						await ctx.db
							.insertInto("system_setting")
							.values({
								key,
								value: stringVal,
								updated_at: now,
							})
							.execute();
					}
				}
			}

			return { success: true };
		}),
});
