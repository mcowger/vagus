import React, { useEffect, useMemo, useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

interface PipelineTask {
	id: string;
	title: string;
	description: string;
	defaultModel: string;
}

const PIPELINE_TASKS: PipelineTask[] = [
	{
		id: "stage_a_bullet",
		title: "Article Summarization",
		description: "Generates 1-2 sentence key bullet points per article for embedding generation and scoring.",
		defaultModel: "gpt-4o-mini",
	},
	{
		id: "article_embedding",
		title: "Vector Embedding Generation",
		description: "Generates dense vector representations of articles for story clustering and interest profile scoring.",
		defaultModel: "text-embedding-3-small",
	},
	{
		id: "event_identity_merge",
		title: "Broad Topic Validation",
		description: "Validates whether related coverage belongs in one reader-facing ongoing story, rather than a broad category or entity.",
		defaultModel: "gpt-4o-mini",
	},
	{
		id: "stage_b_synthesis",
		title: "Story Cluster Synthesis",
		description: "Synthesizes multi-article clusters into unified story overviews and citations.",
		defaultModel: "gpt-4o-mini",
	},
	{
		id: "stage_c_assembly",
		title: "Executive Digest Assembly",
		description: "Assembles executive briefing summaries, why-it-matters strategic analysis, and key takeaways.",
		defaultModel: "gpt-4o-mini",
	},
];

const DEFAULT_PROVIDERS = ["openai", "anthropic", "groq", "ollama", "faux"];

interface ProviderModelItem {
	id: string;
	name: string;
	modality: string | null;
	inputModalities: string[];
	outputModalities: string[];
}

function TaskRow({
	task,
	configuredProviders,
	existingModel,
	onSave,
	isPending,
}: {
	task: PipelineTask;
	configuredProviders: string[];
	existingModel?: { provider: string; model_name: string };
	onSave: (taskName: string, provider: string, modelName: string) => void;
	isPending: boolean;
}) {
	const defaultProvider = configuredProviders[0] || "openai";
	const [selectedProvider, setSelectedProvider] = useState(
		existingModel?.provider || defaultProvider,
	);
	const [modelInput, setModelName] = useState(
		existingModel?.model_name || task.defaultModel,
	);
	const [isCustomInput, setIsCustomInput] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);

	// Fetch dynamic model list from provider's /models endpoint via backend
	const modelsQuery = trpc.providers.getModels.useQuery(
		{ provider: selectedProvider },
		{ enabled: !!selectedProvider },
	);

	// Filter fetched models based on task modality (embedding vs completion)
	const filteredModels = useMemo(() => {
		const rawList = modelsQuery.data || [];
		if (rawList.length === 0) return [];

		const isEmbeddingTask = task.id === "article_embedding";

		return (rawList as ProviderModelItem[]).filter((m: ProviderModelItem) => {
			const isEmbed =
				m.outputModalities.includes("embeddings") ||
				(m.modality && m.modality.includes("embeddings")) ||
				m.id.toLowerCase().includes("embed");

			return isEmbeddingTask ? isEmbed : !isEmbed;
		});
	}, [modelsQuery.data, task.id]);

	useEffect(() => {
		if (existingModel) {
			setSelectedProvider(existingModel.provider);
			setModelName(existingModel.model_name);
		} else if (configuredProviders.length > 0 && !configuredProviders.includes(selectedProvider)) {
			setSelectedProvider(configuredProviders[0]);
		}
	}, [existingModel, configuredProviders]);

	// Auto-select first matching model from /models endpoint when switching providers
	useEffect(() => {
		if (!isCustomInput && filteredModels.length > 0) {
			const exists = filteredModels.some((m: ProviderModelItem) => m.id === modelInput);
			if (!exists && !existingModel) {
				setModelName(filteredModels[0].id);
			}
		}
	}, [filteredModels, isCustomInput, existingModel, modelInput]);

	const availableProviders = useMemo(() => {
		if (configuredProviders.length > 0) {
			return Array.from(new Set([...configuredProviders, selectedProvider].filter(Boolean)));
		}
		return DEFAULT_PROVIDERS;
	}, [configuredProviders, selectedProvider]);

	const handleProviderChange = (p: string) => {
		setSelectedProvider(p);
		setIsCustomInput(false);
		if (task.id === "article_embedding") {
			if (p === "openai") setModelName("text-embedding-3-small");
			else if (p === "ollama") setModelName("nomic-embed-text");
			else if (p === "faux") setModelName("fake-embedder-128");
			else setModelName("text-embedding-3-small");
		} else {
			if (p === "openai") setModelName("gpt-4o-mini");
			else if (p === "anthropic") setModelName("claude-3-5-sonnet");
			else if (p === "groq") setModelName("llama-3.3-70b");
			else if (p === "ollama") setModelName("llama3");
			else if (p === "faux") setModelName("faux-cheap");
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedProvider || !modelInput.trim()) return;
		onSave(task.id, selectedProvider, modelInput.trim());
		setSavedSuccess(true);
		setTimeout(() => setSavedSuccess(false), 2500);
	};

	return (
		<tr className="hover:bg-slate-50/80 transition-colors">
			<td className="py-4 px-4 align-top max-w-xs">
				<div className="font-bold text-slate-900 text-sm">{task.title}</div>
				<div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{task.description}</div>
				<div className="text-[10px] font-mono text-slate-400 mt-1">ID: {task.id}</div>
			</td>

			<td className="py-4 px-4 align-top w-48">
				<select
					value={selectedProvider}
					onChange={(e) => handleProviderChange(e.target.value)}
					className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors capitalize font-medium text-slate-800"
				>
					{availableProviders.map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</select>
			</td>

			<td className="py-4 px-4 align-top min-w-[240px]">
				{filteredModels.length > 0 && !isCustomInput ? (
					<div className="space-y-1">
						<select
							value={modelInput}
							onChange={(e) => {
								if (e.target.value === "__custom__") {
									setIsCustomInput(true);
								} else {
									setModelName(e.target.value);
								}
							}}
							className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm font-mono text-xs text-slate-800 transition-colors"
						>
							{(filteredModels as ProviderModelItem[]).map((m: ProviderModelItem) => (
								<option key={m.id} value={m.id}>
									{m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
								</option>
							))}
							<option value="__custom__">⚙ Custom Model ID...</option>
						</select>
						<div className="text-[10px] text-slate-400 font-mono">
							Fetched {filteredModels.length} {task.id === "article_embedding" ? "embedding" : "text"} model{filteredModels.length > 1 ? "s" : ""} from endpoint
						</div>
					</div>
				) : (
					<div className="space-y-1">
						<Input
							value={modelInput}
							onChange={(e) => setModelName(e.target.value)}
							placeholder="e.g. gpt-4o-mini"
							className="h-9 font-mono text-xs"
							required
						/>
						{filteredModels.length > 0 && (
							<button
								type="button"
								onClick={() => setIsCustomInput(false)}
								className="text-[11px] text-indigo-600 hover:text-indigo-800 underline font-sans"
							>
								Select from endpoint model list ({filteredModels.length})
							</button>
						)}
					</div>
				)}
			</td>

			<td className="py-4 px-4 align-top text-right w-32">
				<Button size="sm" onClick={handleSubmit} disabled={isPending} className="w-full">
					{isPending ? "Saving..." : savedSuccess ? "Saved ✓" : "Save"}
				</Button>
			</td>
		</tr>
	);
}

export const TaskModels: React.FC = () => {
	const utils = trpc.useUtils();
	const taskModelsQuery = trpc.taskModels.getTaskModels.useQuery();
	const llmUsageQuery = trpc.taskModels.getLlmUsage.useQuery();
	const providersQuery = trpc.providers.list.useQuery();

	const setTaskModelMutation = trpc.taskModels.setTaskModel.useMutation({
		onSuccess: () => {
			utils.taskModels.getTaskModels.invalidate();
		},
	});

	// List of providers configured on the Providers page
	const configuredProviders = useMemo(() => {
		return (providersQuery.data || [])
			.filter((p) => p.provider !== "brave-news")
			.map((p) => p.provider);
	}, [providersQuery.data]);

	const handleSaveTaskModel = (taskName: string, provider: string, modelName: string) => {
		setTaskModelMutation.mutate({ taskName, provider, modelName });
	};

	const summary = llmUsageQuery.data?.summary;
	const usageRows = llmUsageQuery.data?.rows || [];

	return (
		<div className="space-y-8 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">
					Pipeline Task Models
				</h1>
				<p className="text-slate-500 mt-1">
					Assign specific AI models and providers to each core stage of the intelligence pipeline.
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

			{/* Clean 1-Row-Per-Task Routing Table */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Task Routing Configuration</CardTitle>
					<CardDescription>
						Select provider endpoint and model choice for each pipeline task
					</CardDescription>
				</CardHeader>
				<CardContent>
					{taskModelsQuery.isLoading || providersQuery.isLoading ? (
						<div className="text-slate-500 py-6">Loading task routing configuration...</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm text-left">
								<thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
									<tr>
										<th className="px-4 py-3">Task Name</th>
										<th className="px-4 py-3">Provider</th>
										<th className="px-4 py-3">Model Selection</th>
										<th className="px-4 py-3 text-right">Action</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200">
									{PIPELINE_TASKS.map((task) => {
										const existing = taskModelsQuery.data?.find(
											(m) => m.task_name === task.id,
										);
										return (
											<TaskRow
												key={task.id}
												task={task}
												configuredProviders={configuredProviders}
												existingModel={existing}
												onSave={handleSaveTaskModel}
												isPending={setTaskModelMutation.isPending}
											/>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

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
									{usageRows.map((u) => {
										const matchedTask = PIPELINE_TASKS.find((t) => t.id === u.task_name);
										const displayTaskName = matchedTask ? matchedTask.title : u.task_name;

										return (
											<tr key={u.id} className="hover:bg-slate-50">
												<td className="px-4 py-3 font-medium text-slate-800">
													<div>{displayTaskName}</div>
													<div className="text-[10px] font-mono text-slate-400">{u.task_name}</div>
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
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
