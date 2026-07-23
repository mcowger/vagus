import React from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const STAGE_TITLE_MAP: Record<string, string> = {
	ingest: "Source Feed Ingestion",
	"fetch-source": "Source Feed Ingestion",
	extract: "Article Content Extraction",
	"extract-article": "Article Content Extraction",
	stage_a: "Article Summarization",
	stage_a_bullet: "Article Summarization",
	embed: "Vector Embedding Generation",
	"embed-article": "Vector Embedding Generation",
	cluster: "Story Clustering",
	"cluster-run": "Story Clustering",
	score: "Profile Relevance Scoring",
	"score-user": "Profile Relevance Scoring",
	synthesize: "Story Cluster Synthesis",
	"synthesize-cluster": "Story Cluster Synthesis",
	synthesize_cluster: "Story Cluster Synthesis",
	assemble: "Executive Digest Assembly",
	stage_c: "Executive Digest Assembly",
	"assemble-digest": "Executive Digest Assembly",
	noop: "No-Op Process",
};

function formatStageName(stage: string): string {
	if (!stage) return "Unknown Stage";
	return STAGE_TITLE_MAP[stage] || stage.replace(/_/g, " ").replace(/-/g, " ");
}

export const Runs: React.FC = () => {
	const utils = trpc.useUtils();
	const runsQuery = trpc.runs.listRuns.useQuery({ limit: 50 }, { refetchInterval: 3000 } as any);
	const startRunMutation = trpc.runs.startRun.useMutation({
		onSuccess: () => utils.runs.listRuns.invalidate(),
	});

	const handleStartRun = () => {
		startRunMutation.mutate({ trigger: "manual" });
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight text-slate-900">Global Article Preparation</h1>
					<p className="text-slate-500 mt-1">
						Monitor global source ingestion, article extraction, and embedding pipeline execution.
					</p>
				</div>
				<Button onClick={handleStartRun} disabled={startRunMutation.isPending}>
					{startRunMutation.isPending ? "Preparing..." : "Prepare Articles Now"}
				</Button>
			</div>

			<div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 leading-relaxed">
				<span className="font-bold text-slate-900 block mb-1">Global Preparation vs. Profile Digest Generation</span>
				Global preparation fetches, extracts, summarizes, and embeds articles across all active feed sources. Individual category profile digests are generated separately on their configured schedules or on demand via <strong>Interest Profiles &rarr; Generate Now</strong>.
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Recent Pipeline Runs</CardTitle>
					<CardDescription>Auto-refreshing every 3s</CardDescription>
				</CardHeader>
				<CardContent>
					{runsQuery.isLoading ? (
						<div className="text-slate-500 py-4">Loading runs...</div>
					) : runsQuery.data?.length === 0 ? (
						<div className="text-slate-500 py-4 text-center border rounded-md border-dashed">
							No runs executed yet. Click 'Prepare Articles Now' above to start global article ingestion!
						</div>
					) : (
						<div className="space-y-3">
							{runsQuery.data?.map((run) => (
								<div
									key={run.id}
									className="p-4 border border-slate-200 rounded-lg bg-white space-y-3"
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3">
											<span className="font-bold text-slate-900">Run #{run.id}</span>
											<span
												className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${
													run.status === "complete"
														? "bg-emerald-100 text-emerald-800"
														: run.status === "running"
														? "bg-blue-100 text-blue-800 animate-pulse"
														: "bg-red-100 text-red-800"
												}`}
											>
												{run.status}
											</span>
											<span className="text-xs text-slate-500 capitalize bg-slate-100 px-2 py-0.5 rounded">
												{run.trigger}
											</span>
										</div>
										<div className="text-xs text-slate-400 font-mono">
											Started: {new Date(run.started_at).toLocaleString()}
										</div>
									</div>

									{run.stages && run.stages.length > 0 && (
										<div className="pt-2 border-t border-slate-100 grid gap-2 md:grid-cols-2">
											{run.stages.map((stage) => (
												<div
													key={stage.id}
													className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex items-center justify-between gap-3"
												>
													<div>
														<div className="flex items-center gap-2">
															<span className="font-bold text-slate-800">
																{formatStageName(stage.stage)}
															</span>
															<span className="text-[10px] text-slate-400 font-mono">
																({stage.stage})
															</span>
														</div>
														<div className="text-slate-500 mt-1 font-mono text-[11px]">
															Progress: {stage.completed} / {stage.expected} jobs
														</div>
													</div>
													<span
														className={`font-mono text-xs px-2 py-0.5 rounded font-semibold capitalize ${
															stage.status === "complete"
																? "bg-emerald-100 text-emerald-800"
																: stage.status === "running"
																? "bg-blue-100 text-blue-800 animate-pulse"
																: "bg-red-100 text-red-800"
														}`}
													>
														{stage.status}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
