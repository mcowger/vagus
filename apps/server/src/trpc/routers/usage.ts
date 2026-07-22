import { protectedProcedure, router } from "../trpc";

export const usageRouter = router({
	getStats: protectedProcedure.query(async ({ ctx }) => {
		const rawGrouped = await ctx.db
			.selectFrom("llm_usage")
			.select([
				"run_id",
				"provider",
				"task_name",
				"model_name",
				ctx.db.fn.sum<number>("prompt_tokens").as("prompt_tokens"),
				ctx.db.fn.sum<number>("completion_tokens").as("completion_tokens"),
				ctx.db.fn.sum<number>("estimated_cost").as("estimated_cost"),
				ctx.db.fn.count<number>("id").as("count"),
			])
			.groupBy(["run_id", "provider", "task_name", "model_name"])
			.execute();

		const grouped = rawGrouped.map((row) => {
			const promptTokens = Number(row.prompt_tokens ?? 0);
			const completionTokens = Number(row.completion_tokens ?? 0);
			const totalTokens = promptTokens + completionTokens;
			const totalCost = Number(row.estimated_cost ?? 0);
			const count = Number(row.count ?? 0);

			return {
				run_id: row.run_id,
				provider: row.provider,
				task_name: row.task_name,
				model_name: row.model_name,
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: totalTokens,
				estimated_cost: totalCost,
				count,
			};
		});

		const totals = grouped.reduce(
			(acc, item) => {
				acc.promptTokens += item.prompt_tokens;
				acc.completionTokens += item.completion_tokens;
				acc.totalTokens += item.total_tokens;
				acc.totalCost += item.estimated_cost;
				acc.totalCalls += item.count;
				return acc;
			},
			{
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				totalCost: 0,
				totalCalls: 0,
			},
		);

		const providerMap = new Map<
			string,
			{
				promptTokens: number;
				completionTokens: number;
				totalTokens: number;
				totalCost: number;
				count: number;
			}
		>();

		const taskModelMap = new Map<
			string,
			{
				taskName: string;
				modelName: string;
				provider: string;
				promptTokens: number;
				completionTokens: number;
				totalTokens: number;
				totalCost: number;
				count: number;
			}
		>();

		for (const item of grouped) {
			// Aggregate by provider
			const p = providerMap.get(item.provider) || {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				totalCost: 0,
				count: 0,
			};
			p.promptTokens += item.prompt_tokens;
			p.completionTokens += item.completion_tokens;
			p.totalTokens += item.total_tokens;
			p.totalCost += item.estimated_cost;
			p.count += item.count;
			providerMap.set(item.provider, p);

			// Aggregate by task & model
			const tmKey = `${item.task_name}::${item.model_name}::${item.provider}`;
			const tm = taskModelMap.get(tmKey) || {
				taskName: item.task_name,
				modelName: item.model_name,
				provider: item.provider,
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				totalCost: 0,
				count: 0,
			};
			tm.promptTokens += item.prompt_tokens;
			tm.completionTokens += item.completion_tokens;
			tm.totalTokens += item.total_tokens;
			tm.totalCost += item.estimated_cost;
			tm.count += item.count;
			taskModelMap.set(tmKey, tm);
		}

		const byProvider = Array.from(providerMap.entries()).map(([provider, stats]) => ({
			provider,
			...stats,
		}));

		const byTaskModel = Array.from(taskModelMap.values());

		return {
			grouped,
			totals,
			byProvider,
			byTaskModel,
		};
	}),
});
