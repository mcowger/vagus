import React from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

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
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight text-slate-900">Run History</h1>
					<p className="text-slate-500 mt-1">Monitor pipeline execution cycles and source ingestion progress.</p>
				</div>
				<Button onClick={handleStartRun} disabled={startRunMutation.isPending}>
					{startRunMutation.isPending ? "Starting..." : "Trigger Manual Run"}
				</Button>
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
							No runs executed yet. Trigger one above!
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
													className="p-2.5 bg-slate-50 rounded border border-slate-200 text-xs flex items-center justify-between"
												>
													<div>
														<span className="font-semibold text-slate-700 capitalize">
															Stage: {stage.stage}
														</span>
														<div className="text-slate-500 mt-0.5">
															Progress: {stage.completed} / {stage.expected} jobs
														</div>
													</div>
													<span className="font-mono text-slate-600 capitalize">
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
