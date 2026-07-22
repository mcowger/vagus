import { z } from "zod";
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

	updateSettings: adminProcedure
		.input(
			z.object({
				article_retention_days: z.union([z.string(), z.number()]).optional(),
				digest_retention_days: z.union([z.string(), z.number()]).optional(),
				ntfy_base_url: z.string().optional(),
				cron_schedule: z.string().optional(),
				app_base_url: z.string().optional(),
				worker_concurrency: z.union([z.string(), z.number()]).optional(),
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
