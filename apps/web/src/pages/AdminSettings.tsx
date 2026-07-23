import React, { useEffect, useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Sparkles, RotateCcw, Save, CheckCircle2, AlertCircle } from "lucide-react";

interface PromptFormState {
	systemPrompt: string;
	userPrompt: string;
}

export const AdminSettings: React.FC = () => {
	const utils = trpc.useUtils();
	const settingsQuery = trpc.settings.getSettings.useQuery();
	const promptsQuery = trpc.settings.getPrompts.useQuery();

	const updateSettingsMutation = trpc.settings.updateSettings.useMutation({
		onSuccess: () => {
			utils.settings.getSettings.invalidate();
			setSuccessMessage("Settings saved successfully.");
			setErrorMessage("");
		},
		onError: (err) => {
			setErrorMessage(err.message || "Failed to update settings.");
			setSuccessMessage("");
		},
	});

	const updatePromptMutation = trpc.settings.updatePrompt.useMutation({
		onSuccess: (_, variables) => {
			utils.settings.getPrompts.invalidate();
			setPromptSuccessMap((prev) => ({ ...prev, [variables.promptKey]: "Prompt saved successfully." }));
		},
		onError: (err, variables) => {
			setPromptErrorMap((prev) => ({ ...prev, [variables.promptKey]: err.message || "Failed to save prompt." }));
		},
	});

	const resetPromptMutation = trpc.settings.resetPrompt.useMutation({
		onSuccess: (_, variables) => {
			utils.settings.getPrompts.invalidate();
			setPromptSuccessMap((prev) => ({ ...prev, [variables.promptKey]: "Prompt reset to default." }));
		},
		onError: (err, variables) => {
			setPromptErrorMap((prev) => ({ ...prev, [variables.promptKey]: err.message || "Failed to reset prompt." }));
		},
	});

	const [articleRetentionDays, setArticleRetentionDays] = useState("30");
	const [digestRetentionDays, setDigestRetentionDays] = useState("90");
	const [cronSchedule, setCronSchedule] = useState("0 * * * *");
	const [ntfyBaseUrl, setNtfyBaseUrl] = useState("https://ntfy.sh");
	const [appBaseUrl, setAppBaseUrl] = useState("http://localhost:5173");
	const [workerConcurrency, setWorkerConcurrency] = useState("5");
	const [clusteringSimilarityThreshold, setClusteringSimilarityThreshold] = useState("0.8");
	const [clusteringLlmMergeMinSimilarity, setClusteringLlmMergeMinSimilarity] = useState("0.45");
	const [clusteringLlmMergeEnabled, setClusteringLlmMergeEnabled] = useState(true);
	const [clusteringLlmMergeMaxCandidates, setClusteringLlmMergeMaxCandidates] = useState("12");
	const [pipelineArticleMaxAgeHours, setPipelineArticleMaxAgeHours] = useState("48");
	const [pipelineFilterFeedArtifacts, setPipelineFilterFeedArtifacts] = useState(true);

	const [successMessage, setSuccessMessage] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	const [promptForms, setPromptForms] = useState<Record<string, PromptFormState>>({});
	const [promptSuccessMap, setPromptSuccessMap] = useState<Record<string, string>>({});
	const [promptErrorMap, setPromptErrorMap] = useState<Record<string, string>>({});

	useEffect(() => {
		if (settingsQuery.data) {
			const s = settingsQuery.data;
			if (s.article_retention_days !== undefined) setArticleRetentionDays(s.article_retention_days);
			if (s.digest_retention_days !== undefined) setDigestRetentionDays(s.digest_retention_days);
			if (s.cron_schedule !== undefined) setCronSchedule(s.cron_schedule);
			if (s.ntfy_base_url !== undefined) setNtfyBaseUrl(s.ntfy_base_url);
			if (s.app_base_url !== undefined) setAppBaseUrl(s.app_base_url);
			if (s.worker_concurrency !== undefined) setWorkerConcurrency(s.worker_concurrency);
			if (s.clustering_similarity_threshold !== undefined) setClusteringSimilarityThreshold(s.clustering_similarity_threshold);
			if (s.clustering_llm_merge_min_similarity !== undefined) setClusteringLlmMergeMinSimilarity(s.clustering_llm_merge_min_similarity);
			if (s.clustering_llm_merge_enabled !== undefined) setClusteringLlmMergeEnabled(s.clustering_llm_merge_enabled !== "false");
			if (s.clustering_llm_merge_max_candidates !== undefined) setClusteringLlmMergeMaxCandidates(s.clustering_llm_merge_max_candidates);
			if (s.pipeline_article_max_age_hours !== undefined) setPipelineArticleMaxAgeHours(s.pipeline_article_max_age_hours);
			if (s.pipeline_filter_feed_artifacts !== undefined) setPipelineFilterFeedArtifacts(s.pipeline_filter_feed_artifacts !== "false");
		}
	}, [settingsQuery.data]);

	useEffect(() => {
		if (promptsQuery.data) {
			const map: Record<string, PromptFormState> = {};
			for (const p of promptsQuery.data) {
				map[p.key] = {
					systemPrompt: p.systemPrompt,
					userPrompt: p.userPrompt,
				};
			}
			setPromptForms(map);
		}
	}, [promptsQuery.data]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setSuccessMessage("");
		setErrorMessage("");

		updateSettingsMutation.mutate({
			article_retention_days: articleRetentionDays,
			digest_retention_days: digestRetentionDays,
			cron_schedule: cronSchedule,
			ntfy_base_url: ntfyBaseUrl,
			app_base_url: appBaseUrl,
			worker_concurrency: workerConcurrency,
			clustering_similarity_threshold: clusteringSimilarityThreshold,
			clustering_llm_merge_min_similarity: clusteringLlmMergeMinSimilarity,
			clustering_llm_merge_enabled: clusteringLlmMergeEnabled,
			clustering_llm_merge_max_candidates: clusteringLlmMergeMaxCandidates,
			pipeline_article_max_age_hours: pipelineArticleMaxAgeHours,
			pipeline_filter_feed_artifacts: pipelineFilterFeedArtifacts,
		});
	};

	const handleSavePrompt = (promptKey: string) => {
		const form = promptForms[promptKey];
		if (!form) return;

		setPromptSuccessMap((prev) => ({ ...prev, [promptKey]: "" }));
		setPromptErrorMap((prev) => ({ ...prev, [promptKey]: "" }));

		updatePromptMutation.mutate({
			promptKey,
			systemPrompt: form.systemPrompt,
			userPrompt: form.userPrompt,
		});
	};

	const handleResetPrompt = (promptKey: string) => {
		setPromptSuccessMap((prev) => ({ ...prev, [promptKey]: "" }));
		setPromptErrorMap((prev) => ({ ...prev, [promptKey]: "" }));

		resetPromptMutation.mutate({ promptKey });
	};

	return (
		<div className="space-y-8 max-w-4xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">
					Admin Settings
				</h1>
				<p className="text-slate-500 mt-1">
					Configure system retention windows, worker concurrency, and editable LLM pipeline prompt templates.
				</p>
			</div>

			{successMessage && (
				<div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
					<CheckCircle2 className="h-4 w-4 text-emerald-600" />
					<span>{successMessage}</span>
				</div>
			)}

			{errorMessage && (
				<div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
					<AlertCircle className="h-4 w-4 text-rose-600" />
					<span>{errorMessage}</span>
				</div>
			)}

			{/* Section 1: System Operational Configuration */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">System Configuration</CardTitle>
					<CardDescription>
						Update operational preferences and default background job settings.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{settingsQuery.isLoading ? (
						<div className="text-slate-500 py-4">Loading system settings...</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-5">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div className="space-y-2">
									<Label htmlFor="clusteringSimilarityThreshold">Story Similarity Threshold</Label>
									<Input id="clusteringSimilarityThreshold" type="number" min="0" max="1" step="0.01" value={clusteringSimilarityThreshold} onChange={(e) => setClusteringSimilarityThreshold(e.target.value)} required />
									<p className="text-xs text-slate-500">Strict similarity required for deterministic multi-source story clusters.</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="clusteringLlmMergeMinSimilarity">LLM Merge Candidate Threshold</Label>
									<Input id="clusteringLlmMergeMinSimilarity" type="number" min="0" max="1" step="0.01" value={clusteringLlmMergeMinSimilarity} onChange={(e) => setClusteringLlmMergeMinSimilarity(e.target.value)} required />
									<p className="text-xs text-slate-500">Lower-bound similarity before the event-identity model evaluates a merge.</p>
								</div>
							</div>

							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input type="checkbox" checked={clusteringLlmMergeEnabled} onChange={(e) => setClusteringLlmMergeEnabled(e.target.checked)} />
								Use LLM event-identity merge for nearby clusters
							</label>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div className="space-y-2">
									<Label htmlFor="clusteringLlmMergeMaxCandidates">LLM Merge Candidate Limit</Label>
									<Input id="clusteringLlmMergeMaxCandidates" type="number" min="0" max="50" value={clusteringLlmMergeMaxCandidates} onChange={(e) => setClusteringLlmMergeMaxCandidates(e.target.value)} required />
									<p className="text-xs text-slate-500">Maximum nearby cluster pairs evaluated per pipeline run.</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="pipelineArticleMaxAgeHours">Article Eligibility Window (Hours)</Label>
									<Input id="pipelineArticleMaxAgeHours" type="number" min="1" max="720" value={pipelineArticleMaxAgeHours} onChange={(e) => setPipelineArticleMaxAgeHours(e.target.value)} required />
									<p className="text-xs text-slate-500">Articles outside this publish-date window never reach extraction or clustering.</p>
								</div>
							</div>

							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input type="checkbox" checked={pipelineFilterFeedArtifacts} onChange={(e) => setPipelineFilterFeedArtifacts(e.target.checked)} />
								Exclude feed hubs, navigation pages, and empty article records
							</label>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div className="space-y-2">
									<Label htmlFor="articleRetention">Article Retention (Days)</Label>
									<Input
										id="articleRetention"
										type="number"
										min="1"
										value={articleRetentionDays}
										onChange={(e) => setArticleRetentionDays(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Days before raw articles are pruned from storage.
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="digestRetention">Digest Retention (Days)</Label>
									<Input
										id="digestRetention"
										type="number"
										min="1"
										value={digestRetentionDays}
										onChange={(e) => setDigestRetentionDays(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Days before generated digests are pruned.
									</p>
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div className="space-y-2">
									<Label htmlFor="cronSchedule">Cron Schedule</Label>
									<Input
										id="cronSchedule"
										type="text"
										placeholder="0 * * * *"
										value={cronSchedule}
										onChange={(e) => setCronSchedule(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Cron expression or interval format (e.g. <code>0 * * * *</code> for hourly).
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="workerConcurrency">Worker Parallel Concurrency</Label>
									<Input
										id="workerConcurrency"
										type="number"
										min="1"
										max="50"
										value={workerConcurrency}
										onChange={(e) => setWorkerConcurrency(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Parallel plainjob workers processing extraction, embedding, and synthesis.
									</p>
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div className="space-y-2">
									<Label htmlFor="ntfyBaseUrl">Ntfy Base URL</Label>
									<Input
										id="ntfyBaseUrl"
										type="url"
										placeholder="https://ntfy.sh"
										value={ntfyBaseUrl}
										onChange={(e) => setNtfyBaseUrl(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Base URL for sending push notifications via ntfy.
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="appBaseUrl">Application Base URL</Label>
									<Input
										id="appBaseUrl"
										type="url"
										placeholder="http://localhost:5173"
										value={appBaseUrl}
										onChange={(e) => setAppBaseUrl(e.target.value)}
										required
									/>
									<p className="text-xs text-slate-500">
										Public URL used for links embedded in push notifications.
									</p>
								</div>
							</div>

							<div className="pt-2 flex justify-end">
								<Button type="submit" disabled={updateSettingsMutation.isPending}>
									{updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
								</Button>
							</div>
						</form>
					)}
				</CardContent>
			</Card>

			{/* Section 2: Editable LLM Pipeline Prompts */}
			<div className="space-y-4">
				<div>
					<h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
						<Sparkles className="h-5 w-5 text-indigo-600" />
						Pipeline LLM Prompts & Templates
					</h2>
					<p className="text-sm text-slate-500 mt-1">
						Customize System and User Prompts across all pipeline stage tasks. Use <code>{"{{variable}}"}</code> tags to inject runtime article and cluster parameters.
					</p>
				</div>

				{promptsQuery.isLoading ? (
					<div className="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
						Loading pipeline prompt templates...
					</div>
				) : (
					<div className="space-y-6">
						{promptsQuery.data?.map((p) => {
							const form = promptForms[p.key] || { systemPrompt: p.systemPrompt, userPrompt: p.userPrompt };
							const isCustomized = p.isCustomized;
							const isPendingSave = updatePromptMutation.isPending && updatePromptMutation.variables?.promptKey === p.key;
							const isPendingReset = resetPromptMutation.isPending && resetPromptMutation.variables?.promptKey === p.key;

							return (
								<Card key={p.key} className="border-slate-200 shadow-xs">
									<CardHeader className="bg-slate-50/80 border-b border-slate-100 py-3.5 px-5">
										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
											<div>
												<div className="flex items-center gap-2">
													<span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-indigo-100 text-indigo-800">
														{p.stage}
													</span>
													<CardTitle className="text-base font-bold text-slate-900">
														{p.name}
													</CardTitle>
													{isCustomized ? (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
															Customized
														</span>
													) : (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
															System Default
														</span>
													)}
												</div>
												<CardDescription className="text-xs text-slate-500 mt-1">
													{p.description}
												</CardDescription>
											</div>

											{/* Available Variables Pills */}
											<div className="flex flex-wrap items-center gap-1">
												<span className="text-[11px] text-slate-400 font-medium mr-1">Vars:</span>
												{p.variables.map((v) => (
													<code
														key={v}
														className="px-1.5 py-0.5 bg-slate-200/80 text-slate-800 rounded text-[11px] font-mono border border-slate-300"
													>
														{`{{${v}}}`}
													</code>
												))}
											</div>
										</div>
									</CardHeader>

									<CardContent className="p-5 space-y-4">
										{promptSuccessMap[p.key] && (
											<div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
												<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
												<span>{promptSuccessMap[p.key]}</span>
											</div>
										)}

										{promptErrorMap[p.key] && (
											<div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
												<AlertCircle className="h-3.5 w-3.5 text-rose-600" />
												<span>{promptErrorMap[p.key]}</span>
											</div>
										)}

										{/* System Prompt Field */}
										<div className="space-y-1.5">
											<Label className="text-xs font-semibold text-slate-700">System Prompt / Role Instruction</Label>
											<textarea
												rows={2}
												value={form.systemPrompt}
												onChange={(e) =>
													setPromptForms((prev) => ({
														...prev,
														[p.key]: { ...form, systemPrompt: e.target.value },
													}))
												}
												className="w-full p-2.5 rounded-md border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
												placeholder="Enter system prompt instruction..."
											/>
										</div>

										{/* User Prompt Template Field */}
										<div className="space-y-1.5">
											<Label className="text-xs font-semibold text-slate-700">User Prompt Template</Label>
											<textarea
												rows={6}
												value={form.userPrompt}
												onChange={(e) =>
													setPromptForms((prev) => ({
														...prev,
														[p.key]: { ...form, userPrompt: e.target.value },
													}))
												}
												className="w-full p-2.5 rounded-md border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
												placeholder="Enter user prompt template with {{variables}}..."
											/>
										</div>

										{/* Actions */}
										<div className="flex items-center justify-between pt-2">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => handleResetPrompt(p.key)}
												disabled={isPendingReset || !isCustomized}
												className="text-xs text-slate-600 hover:text-slate-900 gap-1.5"
											>
												<RotateCcw className="h-3.5 w-3.5" />
												{isPendingReset ? "Resetting..." : "Reset to Default"}
											</Button>

											<Button
												type="button"
												size="sm"
												onClick={() => handleSavePrompt(p.key)}
												disabled={isPendingSave}
												className="gap-1.5"
											>
												<Save className="h-3.5 w-3.5" />
												{isPendingSave ? "Saving..." : "Save Prompt"}
											</Button>
										</div>
									</CardContent>
								</Card>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
};
