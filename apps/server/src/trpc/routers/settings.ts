import { z } from "zod";
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
