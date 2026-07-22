import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { trpc } from "../trpc";

export const UsageDashboard: React.FC = () => {
	const usageQuery = trpc.usage.getStats.useQuery();

	const totals = usageQuery.data?.totals ?? {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		totalCost: 0,
		totalCalls: 0,
	};

	const grouped = usageQuery.data?.grouped ?? [];
	const byProvider = usageQuery.data?.byProvider ?? [];
	const byTaskModel = usageQuery.data?.byTaskModel ?? [];

	const promptPct = totals.totalTokens > 0
		? Math.round((totals.promptTokens / totals.totalTokens) * 100)
		: 0;
	const completionPct = totals.totalTokens > 0 ? 100 - promptPct : 0;

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">
					Usage & Cost Dashboard
				</h1>
				<p className="text-slate-500 mt-1">
					Monitor LLM token consumption, estimated costs, and model performance across pipeline runs.
				</p>
			</div>

			{/* Total Cost & Token Overview Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Total Estimated Cost</CardDescription>
						<CardTitle className="text-2xl font-bold text-emerald-600">
							${totals.totalCost.toFixed(6)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-xs text-slate-500">Across {totals.totalCalls} total LLM calls</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Total Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold">
							{totals.totalTokens.toLocaleString()}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-xs text-slate-500">Combined prompt & completion</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Prompt Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold text-blue-600">
							{totals.promptTokens.toLocaleString()}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-xs text-slate-500">{promptPct}% of token volume</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Completion Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold text-indigo-600">
							{totals.completionTokens.toLocaleString()}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-xs text-slate-500">{completionPct}% of token volume</div>
					</CardContent>
				</Card>
			</div>

			{/* Token Consumption Totals (Prompt vs Completion) */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Token Consumption Totals (Prompt vs Completion)</CardTitle>
					<CardDescription>
						Breakdown of input tokens sent vs output tokens generated
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Progress bar visual */}
					<div className="space-y-1.5">
						<div className="flex justify-between text-xs font-medium text-slate-600">
							<span>Prompt: {totals.promptTokens.toLocaleString()} ({promptPct}%)</span>
							<span>Completion: {totals.completionTokens.toLocaleString()} ({completionPct}%)</span>
						</div>
						<div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex">
							<div
								className="bg-blue-500 transition-all duration-300"
								style={{ width: `${promptPct}%` }}
								title={`Prompt Tokens: ${totals.promptTokens.toLocaleString()} (${promptPct}%)`}
							/>
							<div
								className="bg-indigo-500 transition-all duration-300"
								style={{ width: `${completionPct}%` }}
								title={`Completion Tokens: ${totals.completionTokens.toLocaleString()} (${completionPct}%)`}
							/>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2 pt-2">
						<div className="p-4 border border-blue-100 bg-blue-50/50 rounded-lg">
							<div className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
								Prompt Tokens (Input)
							</div>
							<div className="text-2xl font-bold text-slate-900 mt-1">
								{totals.promptTokens.toLocaleString()}
							</div>
							<div className="text-xs text-slate-500 mt-1">
								Input context, prompt instructions, and system messages
							</div>
						</div>

						<div className="p-4 border border-indigo-100 bg-indigo-50/50 rounded-lg">
							<div className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
								Completion Tokens (Output)
							</div>
							<div className="text-2xl font-bold text-slate-900 mt-1">
								{totals.completionTokens.toLocaleString()}
							</div>
							<div className="text-xs text-slate-500 mt-1">
								Model-generated summaries, extractions, and responses
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Breakdown by Provider & Task Model */}
			<div className="grid gap-6 lg:grid-cols-2">
				{/* Breakdown by LLM Provider */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Breakdown by LLM Provider</CardTitle>
						<CardDescription>Usage and expenditure grouped by AI provider</CardDescription>
					</CardHeader>
					<CardContent>
						{usageQuery.isLoading ? (
							<div className="text-slate-500 py-4">Loading provider stats...</div>
						) : byProvider.length === 0 ? (
							<div className="text-slate-500 py-6 text-center border rounded-md border-dashed">
								No usage records found.
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-sm text-left">
									<thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
										<tr>
											<th className="px-3 py-2">Provider</th>
											<th className="px-3 py-2 text-right">Tokens</th>
											<th className="px-3 py-2 text-right">Calls</th>
											<th className="px-3 py-2 text-right">Cost</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200">
										{byProvider.map((p) => (
											<tr key={p.provider} className="hover:bg-slate-50">
												<td className="px-3 py-2.5 font-semibold text-slate-800">
													{p.provider}
												</td>
												<td className="px-3 py-2.5 text-right font-mono text-xs">
													{p.totalTokens.toLocaleString()}
												</td>
												<td className="px-3 py-2.5 text-right font-mono text-xs text-slate-600">
													{p.count}
												</td>
												<td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-600 font-medium">
													${p.totalCost.toFixed(6)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Breakdown by Task & Model */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Breakdown by Task & Model</CardTitle>
						<CardDescription>Consumption per task type and assigned model</CardDescription>
					</CardHeader>
					<CardContent>
						{usageQuery.isLoading ? (
							<div className="text-slate-500 py-4">Loading task model stats...</div>
						) : byTaskModel.length === 0 ? (
							<div className="text-slate-500 py-6 text-center border rounded-md border-dashed">
								No usage records found.
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-sm text-left">
									<thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
										<tr>
											<th className="px-3 py-2">Task</th>
											<th className="px-3 py-2">Model</th>
											<th className="px-3 py-2 text-right">Tokens</th>
											<th className="px-3 py-2 text-right">Cost</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200">
										{byTaskModel.map((tm) => (
											<tr
												key={`${tm.taskName}-${tm.modelName}-${tm.provider}`}
												className="hover:bg-slate-50"
											>
												<td className="px-3 py-2.5 font-mono text-xs font-medium text-slate-800">
													{tm.taskName}
												</td>
												<td className="px-3 py-2.5 font-mono text-xs text-slate-600">
													{tm.modelName}
													<span className="ml-1 text-[10px] text-slate-400">({tm.provider})</span>
												</td>
												<td className="px-3 py-2.5 text-right font-mono text-xs">
													{tm.totalTokens.toLocaleString()}
												</td>
												<td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-600 font-medium">
													${tm.totalCost.toFixed(6)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Grouped Run Usage Log Table */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Detailed Usage by Run, Task & Model</CardTitle>
					<CardDescription>
						Grouped aggregation by run_id, provider, task_name, and model_name
					</CardDescription>
				</CardHeader>
				<CardContent>
					{usageQuery.isLoading ? (
						<div className="text-slate-500 py-4">Loading usage details...</div>
					) : grouped.length === 0 ? (
						<div className="text-slate-500 py-6 text-center border rounded-md border-dashed">
							No grouped LLM usage records.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm text-left">
								<thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
									<tr>
										<th className="px-4 py-3">Run ID</th>
										<th className="px-4 py-3">Task Name</th>
										<th className="px-4 py-3">Provider</th>
										<th className="px-4 py-3">Model Name</th>
										<th className="px-4 py-3 text-right">Prompt</th>
										<th className="px-4 py-3 text-right">Completion</th>
										<th className="px-4 py-3 text-right">Total Tokens</th>
										<th className="px-4 py-3 text-right">Calls</th>
										<th className="px-4 py-3 text-right">Est. Cost</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200">
									{grouped.map((g, idx) => (
										<tr
											key={`${g.run_id ?? "null"}-${g.task_name}-${g.provider}-${g.model_name}-${idx}`}
											className="hover:bg-slate-50"
										>
											<td className="px-4 py-3 font-mono font-medium text-slate-700">
												{g.run_id !== null ? `#${g.run_id}` : <span className="text-slate-400 font-sans italic">N/A</span>}
											</td>
											<td className="px-4 py-3 font-mono font-medium text-slate-800">
												{g.task_name}
											</td>
											<td className="px-4 py-3 text-slate-600">{g.provider}</td>
											<td className="px-4 py-3 font-mono text-xs text-slate-600">
												{g.model_name}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
												{g.prompt_tokens.toLocaleString()}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
												{g.completion_tokens.toLocaleString()}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-800">
												{g.total_tokens.toLocaleString()}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
												{g.count}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-emerald-600 font-medium">
												${g.estimated_cost.toFixed(6)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
