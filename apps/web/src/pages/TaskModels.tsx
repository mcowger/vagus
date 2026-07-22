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

const DEFAULT_PROVIDERS = ["openai", "anthropic", "groq", "ollama", "faux"];

export const TaskModels: React.FC = () => {
	const utils = trpc.useUtils();
	const taskModelsQuery = trpc.taskModels.getTaskModels.useQuery();
	const llmUsageQuery = trpc.taskModels.getLlmUsage.useQuery();
	const providersQuery = trpc.providers.list.useQuery();

	const setTaskModelMutation = trpc.taskModels.setTaskModel.useMutation({
		onSuccess: () => {
			utils.taskModels.getTaskModels.invalidate();
			resetForm();
		},
	});

	const deleteTaskModelMutation = trpc.taskModels.deleteTaskModel.useMutation({
		onSuccess: () => {
			utils.taskModels.getTaskModels.invalidate();
		},
	});

	const [taskName, setTaskName] = useState("stage_a_bullet");
	const [customTask, setCustomTask] = useState("");
	const [provider, setProvider] = useState("faux");
	const [modelName, setModelName] = useState("faux-cheap");
	const [isCustomTask, setIsCustomTask] = useState(false);
	const [editingTaskName, setEditingTaskName] = useState<string | null>(null);

	// Combine default providers with any custom configured providers from backend
	const configuredProviderNames = (providersQuery.data || [])
		.filter((p) => p.provider !== "brave-news")
		.map((p) => p.provider);

	const availableProviders = Array.from(
		new Set([...DEFAULT_PROVIDERS, ...configuredProviderNames]),
	);

	const activeTaskName = isCustomTask ? customTask.trim() : taskName;

	const resetForm = () => {
		setEditingTaskName(null);
		setIsCustomTask(false);
		setTaskName("stage_a_bullet");
		setCustomTask("");
		setProvider("faux");
		setModelName("faux-cheap");
	};

	const handleSaveModel = (e: React.FormEvent) => {
		e.preventDefault();
		if (!activeTaskName || !provider || !modelName) return;

		setTaskModelMutation.mutate({
			taskName: activeTaskName,
			provider,
			modelName: modelName.trim(),
		});
	};

	const handleEditModel = (model: { task_name: string; provider: string; model_name: string }) => {
		setEditingTaskName(model.task_name);
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
					Route pipeline stage tasks to specific AI models, edit task model associations, and monitor usage.
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
						<CardTitle className="text-lg">
							{editingTaskName ? "Edit Task Model" : "Set Task Model"}
						</CardTitle>
						<CardDescription>Assign provider and model routing to a pipeline task</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSaveModel} className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label htmlFor="taskSelect">Task Name</Label>
									{!editingTaskName && (
										<button
											type="button"
											onClick={() => setIsCustomTask(!isCustomTask)}
											className="text-xs text-slate-500 hover:text-slate-900 underline"
										>
											{isCustomTask ? "Select standard" : "Custom task"}
										</button>
									)}
								</div>

								{isCustomTask ? (
									<Input
										id="customTask"
										placeholder="e.g. stage_c_digest"
										value={customTask}
										onChange={(e) => setCustomTask(e.target.value)}
										required
										disabled={!!editingTaskName}
									/>
								) : (
									<select
										id="taskSelect"
										value={taskName}
										onChange={(e) => setTaskName(e.target.value)}
										disabled={!!editingTaskName}
										className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors disabled:opacity-75"
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
										else if (p === "ollama") setModelName("llama3");
									}}
									className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors capitalize"
								>
									{availableProviders.map((p) => (
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
									placeholder="e.g. gpt-4o-mini, llama3, custom-model"
									value={modelName}
									onChange={(e) => setModelName(e.target.value)}
									required
								/>
							</div>

							<div className="flex items-center gap-2 pt-2">
								<Button
									type="submit"
									className="flex-1"
									disabled={setTaskModelMutation.isPending || !activeTaskName}
								>
									{setTaskModelMutation.isPending
										? "Saving..."
										: editingTaskName
										? "Update Task Model"
										: "Save Model Config"}
								</Button>
								{editingTaskName && (
									<Button type="button" variant="outline" onClick={resetForm}>
										Cancel
									</Button>
								)}
							</div>
						</form>
					</CardContent>
				</Card>

				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-lg">Configured Task Models</CardTitle>
						<CardDescription>Active model routing table per pipeline stage</CardDescription>
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
										className="flex items-center justify-between p-3.5 border border-slate-200 rounded-lg bg-white shadow-sm"
									>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-bold text-slate-900 font-mono text-sm">
													{m.task_name}
												</span>
												<span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-semibold capitalize">
													{m.provider}
												</span>
											</div>
											<div className="text-xs text-slate-500 mt-1 font-mono">
												Model: <span className="text-slate-800 font-medium">{m.model_name}</span>
											</div>
										</div>
										<div className="flex items-center gap-2">
											<Button variant="outline" size="sm" onClick={() => handleEditModel(m)}>
												Edit
											</Button>
											<Button
												variant="destructive"
												size="sm"
												onClick={() => deleteTaskModelMutation.mutate({ id: m.id })}
												disabled={deleteTaskModelMutation.isPending}
											>
												Delete
											</Button>
										</div>
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
											<td className="px-4 py-3 text-slate-600 capitalize">{u.provider}</td>
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
