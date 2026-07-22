import React, { useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const SUGGESTED_TASKS = [
	"stage_a_bullet",
	"stage_b_synthesis",
	"stage_c_digest",
];

const SUGGESTED_PROVIDERS = ["openai", "anthropic", "groq", "faux"];

export const TaskModels: React.FC = () => {
	const utils = trpc.useUtils();
	const taskModelsQuery = trpc.taskModels.getTaskModels.useQuery();
	const llmUsageQuery = trpc.taskModels.getLlmUsage.useQuery();

	const setTaskModelMutation = trpc.taskModels.setTaskModel.useMutation({
		onSuccess: () => {
			utils.taskModels.getTaskModels.invalidate();
		},
	});

	const [taskName, setTaskName] = useState("stage_a_bullet");
	const [customTask, setCustomTask] = useState("");
	const [provider, setProvider] = useState("faux");
	const [modelName, setModelName] = useState("faux-cheap");
	const [isCustomTask, setIsCustomTask] = useState(false);

	const activeTaskName = isCustomTask ? customTask : taskName;

	const handleSaveModel = (e: React.FormEvent) => {
		e.preventDefault();
		if (!activeTaskName || !provider || !modelName) return;

		setTaskModelMutation.mutate({
			taskName: activeTaskName,
			provider,
			modelName,
		});
	};

	const handleEditModel = (model: { task_name: string; provider: string; model_name: string }) => {
		if (SUGGESTED_TASKS.includes(model.task_name)) {
			setIsCustomTask(false);
			setTaskName(model.task_name);
		} else {
			setIsCustomTask(true);
			setCustomTask(model.task_name);
		}
		setProvider(model.provider);
		setModelName(model.model_name);
	};

	const summary = llmUsageQuery.data?.summary;
	const usageRows = llmUsageQuery.data?.rows || [];

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">
					Per-Task Model Configuration
				</h1>
				<p className="text-slate-500 mt-1">
					Configure AI model choices for pipeline stages and monitor LLM token usage and costs.
				</p>
			</div>

			{/* Usage Overview Stats */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Total Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold">
							{(summary?.totalTokens ?? 0).toLocaleString()}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Prompt Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold">
							{(summary?.totalPromptTokens ?? 0).toLocaleString()}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Completion Tokens</CardDescription>
						<CardTitle className="text-2xl font-bold">
							{(summary?.totalCompletionTokens ?? 0).toLocaleString()}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription className="text-xs font-medium">Estimated Cost</CardDescription>
						<CardTitle className="text-2xl font-bold text-emerald-600">
							${(summary?.totalCost ?? 0).toFixed(6)}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{/* Configuration Section */}
			<div className="grid gap-6 md:grid-cols-3">
				<Card className="md:col-span-1">
					<CardHeader>
						<CardTitle className="text-lg">Set Task Model</CardTitle>
						<CardDescription>Assign provider and model to a task</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSaveModel} className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label htmlFor="taskSelect">Task Name</Label>
									<button
										type="button"
										onClick={() => setIsCustomTask(!isCustomTask)}
										className="text-xs text-slate-500 hover:text-slate-900 underline"
									>
										{isCustomTask ? "Select standard" : "Custom task"}
									</button>
								</div>

								{isCustomTask ? (
									<Input
										id="customTask"
										placeholder="e.g. stage_c_digest"
										value={customTask}
										onChange={(e) => setCustomTask(e.target.value)}
										required
									/>
								) : (
									<select
										id="taskSelect"
										value={taskName}
										onChange={(e) => setTaskName(e.target.value)}
										className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors"
									>
										{SUGGESTED_TASKS.map((t) => (
											<option key={t} value={t}>
												{t}
											</option>
										))}
									</select>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="provider">Provider</Label>
								<select
									id="provider"
									value={provider}
									onChange={(e) => {
										const p = e.target.value;
										setProvider(p);
										if (p === "faux") setModelName("faux-cheap");
										else if (p === "openai") setModelName("gpt-4o-mini");
										else if (p === "anthropic") setModelName("claude-3-5-sonnet");
										else if (p === "groq") setModelName("llama-3.3-70b");
									}}
									className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors"
								>
									{SUGGESTED_PROVIDERS.map((p) => (
										<option key={p} value={p}>
											{p}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-2">
								<Label htmlFor="modelName">Model Name</Label>
								<Input
									id="modelName"
									placeholder="e.g. gpt-4o-mini"
									value={modelName}
									onChange={(e) => setModelName(e.target.value)}
									required
								/>
							</div>

							<Button type="submit" className="w-full" disabled={setTaskModelMutation.isPending}>
								{setTaskModelMutation.isPending ? "Saving..." : "Save Model Config"}
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-lg">Configured Task Models</CardTitle>
						<CardDescription>Active model routing table per stage/task</CardDescription>
					</CardHeader>
					<CardContent>
						{taskModelsQuery.isLoading ? (
							<div className="text-slate-500 py-4">Loading configurations...</div>
						) : taskModelsQuery.data?.length === 0 ? (
							<div className="text-slate-500 py-4 text-center border rounded-md border-dashed">
								No per-task models configured yet.
							</div>
						) : (
							<div className="space-y-3">
								{taskModelsQuery.data?.map((m) => (
									<div
										key={m.id}
										className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-white"
									>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-semibold text-slate-800 font-mono text-sm">
													{m.task_name}
												</span>
												<span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-mono text-slate-600">
													{m.provider}
												</span>
											</div>
											<div className="text-xs text-slate-500 mt-1 font-mono">
												Model: {m.model_name}
											</div>
										</div>
										<Button variant="outline" size="sm" onClick={() => handleEditModel(m)}>
											Edit
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* LLM Usage Table */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">LLM Token Usage Log</CardTitle>
					<CardDescription>Detailed token consumption and cost breakdown by task call</CardDescription>
				</CardHeader>
				<CardContent>
					{llmUsageQuery.isLoading ? (
						<div className="text-slate-500 py-4">Loading usage log...</div>
					) : usageRows.length === 0 ? (
						<div className="text-slate-500 py-6 text-center border rounded-md border-dashed">
							No LLM usage recorded yet.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm text-left">
								<thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
									<tr>
										<th className="px-4 py-3">Task</th>
										<th className="px-4 py-3">Provider</th>
										<th className="px-4 py-3">Model</th>
										<th className="px-4 py-3 text-right">Prompt Tokens</th>
										<th className="px-4 py-3 text-right">Completion Tokens</th>
										<th className="px-4 py-3 text-right">Est. Cost</th>
										<th className="px-4 py-3">Created</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200">
									{usageRows.map((u) => (
										<tr key={u.id} className="hover:bg-slate-50">
											<td className="px-4 py-3 font-mono font-medium text-slate-800">
												{u.task_name}
											</td>
											<td className="px-4 py-3 text-slate-600">{u.provider}</td>
											<td className="px-4 py-3 font-mono text-xs text-slate-600">
												{u.model_name}
											</td>
											<td className="px-4 py-3 text-right font-mono text-slate-700">
												{u.prompt_tokens.toLocaleString()}
											</td>
											<td className="px-4 py-3 text-right font-mono text-slate-700">
												{u.completion_tokens.toLocaleString()}
											</td>
											<td className="px-4 py-3 text-right font-mono text-emerald-600 font-medium">
												${u.estimated_cost.toFixed(6)}
											</td>
											<td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
												{new Date(u.created_at).toLocaleString()}
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
