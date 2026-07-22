import React, { useEffect, useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export const AdminSettings: React.FC = () => {
	const utils = trpc.useUtils();
	const settingsQuery = trpc.settings.getSettings.useQuery();
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

	const [articleRetentionDays, setArticleRetentionDays] = useState("30");
	const [digestRetentionDays, setDigestRetentionDays] = useState("90");
	const [cronSchedule, setCronSchedule] = useState("0 * * * *");
	const [ntfyBaseUrl, setNtfyBaseUrl] = useState("https://ntfy.sh");
	const [appBaseUrl, setAppBaseUrl] = useState("http://localhost:5173");
	const [workerConcurrency, setWorkerConcurrency] = useState("5");

	const [successMessage, setSuccessMessage] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		if (settingsQuery.data) {
			const s = settingsQuery.data;
			if (s.article_retention_days !== undefined) setArticleRetentionDays(s.article_retention_days);
			if (s.digest_retention_days !== undefined) setDigestRetentionDays(s.digest_retention_days);
			if (s.cron_schedule !== undefined) setCronSchedule(s.cron_schedule);
			if (s.ntfy_base_url !== undefined) setNtfyBaseUrl(s.ntfy_base_url);
			if (s.app_base_url !== undefined) setAppBaseUrl(s.app_base_url);
			if (s.worker_concurrency !== undefined) setWorkerConcurrency(s.worker_concurrency);
		}
	}, [settingsQuery.data]);

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
		});
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">
					Admin Settings
				</h1>
				<p className="text-slate-500 mt-1">
					Configure system retention windows, execution cron schedules, and notification settings.
				</p>
			</div>

			{successMessage && (
				<div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
					{successMessage}
				</div>
			)}

			{errorMessage && (
				<div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm">
					{errorMessage}
				</div>
			)}

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
									Number of days before raw articles are pruned from storage.
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
									Number of days before generated digests are pruned.
								</p>
							</div>

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
									Number of parallel plainjob worker instances processing extraction, embedding, and synthesis jobs concurrently.
								</p>
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
		</div>
	);
};
