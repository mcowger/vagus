import { z } from "zod";
import { adminProcedure, router } from "../trpc";

export const taskModelsRouter = router({
	getTaskModels: adminProcedure.query(async ({ ctx }) => {
		return await ctx.db
			.selectFrom("task_model")
			.selectAll()
			.orderBy("task_name", "asc")
			.execute();
	}),

	setTaskModel: adminProcedure
		.input(
			z.object({
				taskName: z.string().min(1),
				provider: z.string().min(1),
				modelName: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			const existing = await ctx.db
				.selectFrom("task_model")
				.selectAll()
				.where("task_name", "=", input.taskName)
				.executeTakeFirst();

			if (existing) {
				await ctx.db
					.updateTable("task_model")
					.set({
						provider: input.provider,
						model_name: input.modelName,
						updated_at: now,
					})
					.where("id", "=", existing.id)
					.execute();

				return { success: true, id: existing.id };
			}

			const inserted = await ctx.db
				.insertInto("task_model")
				.values({
					task_name: input.taskName,
					provider: input.provider,
					model_name: input.modelName,
					created_at: now,
					updated_at: now,
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			return { success: true, id: inserted.id };
		}),

	deleteTaskModel: adminProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.deleteFrom("task_model")
				.where("id", "=", input.id)
				.execute();
			return { success: true };
		}),

	getLlmUsage: adminProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(500).optional().default(100),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const limit = input?.limit ?? 100;
			const rows = await ctx.db
				.selectFrom("llm_usage")
				.selectAll()
				.orderBy("id", "desc")
				.limit(limit)
				.execute();

			const totals = rows.reduce(
				(acc, row) => {
					acc.totalPromptTokens += row.prompt_tokens;
					acc.totalCompletionTokens += row.completion_tokens;
					acc.totalTokens += row.prompt_tokens + row.completion_tokens;
					acc.totalCost += row.estimated_cost;
					return acc;
				},
				{
					totalPromptTokens: 0,
					totalCompletionTokens: 0,
					totalTokens: 0,
					totalCost: 0,
				},
			);

			return {
				rows,
				summary: totals,
			};
		}),
});
