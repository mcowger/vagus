import React, { useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ThumbsUp, ThumbsDown, Sliders } from "lucide-react";

export const Sources: React.FC = () => {
	const utils = trpc.useUtils();
	const sourcesQuery = trpc.sources.list.useQuery();
	const feedbackQuery = trpc.feedback.getFeedbackStats.useQuery();

	const voteSourceMutation = trpc.feedback.voteSource.useMutation({
		onSuccess: () => {
			utils.feedback.getFeedbackStats.invalidate();
		},
	});
	const createSourceMutation = trpc.sources.create.useMutation({
		onSuccess: () => {
			utils.sources.list.invalidate();
			setName("");
			setUrl("");
			setConfig("");
		},
	});
	const updateSourceMutation = trpc.sources.update.useMutation({
		onSuccess: () => utils.sources.list.invalidate(),
	});
	const deleteSourceMutation = trpc.sources.delete.useMutation({
		onSuccess: () => utils.sources.list.invalidate(),
	});

	const [type, setType] = useState<"rss" | "brave-news">("rss");
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [config, setConfig] = useState("");
	const [isPrivate, setIsPrivate] = useState(false);

	const handleCreate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name) return;
		createSourceMutation.mutate({
			type,
			name,
			url: url || null,
			config: config ? (type === "brave-news" ? JSON.stringify({ query: config }) : config) : null,
			isPrivate,
		});
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">Sources</h1>
				<p className="text-slate-500 mt-1">Configure global and private news feed sources.</p>
			</div>

			<div className="grid gap-6 md:grid-cols-3">
				<Card className="md:col-span-1">
					<CardHeader>
						<CardTitle className="text-lg">Add Source</CardTitle>
						<CardDescription>New feed or search topic</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleCreate} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="type">Type</Label>
								<select
									id="type"
									value={type}
									onChange={(e) => setType(e.target.value as any)}
									className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors"
								>
									<option value="rss">RSS Feed</option>
									<option value="brave-news">Brave News Query</option>
								</select>
							</div>

							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									placeholder="e.g. Hacker News RSS"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
								/>
							</div>

							{type === "rss" ? (
								<div className="space-y-2">
									<Label htmlFor="url">Feed URL</Label>
									<Input
										id="url"
										placeholder="https://example.com/rss.xml"
										value={url}
										onChange={(e) => setUrl(e.target.value)}
										required
									/>
								</div>
							) : (
								<div className="space-y-2">
									<Label htmlFor="query">Search Query</Label>
									<Input
										id="query"
										placeholder="e.g. AI technology breakthroughs"
										value={config}
										onChange={(e) => setConfig(e.target.value)}
										required
									/>
								</div>
							)}

							<div className="flex items-center gap-2 pt-1">
								<input
									type="checkbox"
									id="isPrivate"
									checked={isPrivate}
									onChange={(e) => setIsPrivate(e.target.checked)}
									className="rounded border-slate-300"
								/>
								<Label htmlFor="isPrivate" className="text-xs font-normal text-slate-600">
									Private to my account
								</Label>
							</div>

							<Button type="submit" className="w-full" disabled={createSourceMutation.isPending}>
								{createSourceMutation.isPending ? "Saving..." : "Add Source"}
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-lg">Configured Sources</CardTitle>
						<CardDescription>Active sources in pool</CardDescription>
					</CardHeader>
					<CardContent>
						{sourcesQuery.isLoading ? (
							<div className="text-slate-500 py-4">Loading sources...</div>
						) : sourcesQuery.data?.length === 0 ? (
							<div className="text-slate-500 py-4 text-center border rounded-md border-dashed">
								No sources configured yet. Add one on the left!
							</div>
						) : (
							<div className="space-y-3">
								{sourcesQuery.data?.map((s) => {
									const sourceWeightRow = feedbackQuery.data?.sourceWeights?.find((sw) => sw.source_id === s.id);
									const currentWeight = sourceWeightRow?.weight ?? 1.0;
									const sourceVote = feedbackQuery.data?.feedback?.[`source:${s.id}`] ?? 0;

									let weightLabel = `${currentWeight.toFixed(1)}x`;
									let weightColor = "bg-slate-100 text-slate-700 border-slate-200";

									if (currentWeight <= 0.1) {
										weightLabel = "0.0x (Muted)";
										weightColor = "bg-rose-100 text-rose-800 border-rose-200 font-bold";
									} else if (currentWeight > 1.0) {
										weightLabel = `${currentWeight.toFixed(1)}x (Boosted)`;
										weightColor = "bg-emerald-100 text-emerald-800 border-emerald-200 font-bold";
									} else if (currentWeight < 1.0) {
										weightLabel = `${currentWeight.toFixed(1)}x (Lowered)`;
										weightColor = "bg-amber-100 text-amber-800 border-amber-200 font-bold";
									}

									return (
										<div
											key={s.id}
											className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-slate-200 rounded-lg bg-white gap-3"
										>
											<div>
												<div className="flex items-center gap-2 flex-wrap">
													<span className="font-semibold text-slate-800">{s.name}</span>
													<span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-mono text-slate-600">
														{s.type}
													</span>
													{s.owner_user_id && (
														<span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium border border-amber-200">
															Private
														</span>
													)}
													<span className={`text-[11px] px-2 py-0.5 rounded-full border ${weightColor}`}>
														{weightLabel}
													</span>
												</div>
												<div className="text-xs text-slate-500 mt-1 font-mono">
													{s.type === "rss" ? s.url : s.config}
												</div>
											</div>

											<div className="flex items-center gap-2 self-end sm:self-auto">
												{/* Thumbs Up / Down Weight Tuning Controls */}
												<div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1">
													<button
														type="button"
														title="Boost source score weight (+0.3x)"
														onClick={() =>
															voteSourceMutation.mutate({
																sourceId: s.id,
																vote: 1,
															})
														}
														className={`p-1 rounded-md transition-all ${
															sourceVote === 1
																? "bg-emerald-100 text-emerald-700 font-bold shadow-2xs"
																: "text-slate-400 hover:text-emerald-600 hover:bg-white"
														}`}
													>
														<ThumbsUp className="h-3.5 w-3.5" />
													</button>
													<button
														type="button"
														title="Deprioritize / Mute source weight (-0.3x)"
														onClick={() =>
															voteSourceMutation.mutate({
																sourceId: s.id,
																vote: -1,
															})
														}
														className={`p-1 rounded-md transition-all ${
															sourceVote === -1
																? "bg-rose-100 text-rose-700 font-bold shadow-2xs"
																: "text-slate-400 hover:text-rose-600 hover:bg-white"
														}`}
													>
														<ThumbsDown className="h-3.5 w-3.5" />
													</button>
												</div>

												<Button
													variant={s.enabled === 1 ? "outline" : "ghost"}
													size="sm"
													onClick={() =>
														updateSourceMutation.mutate({
															id: s.id,
															enabled: s.enabled === 0,
														})
													}
												>
													{s.enabled === 1 ? "Enabled" : "Disabled"}
												</Button>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => deleteSourceMutation.mutate({ id: s.id })}
												>
													Delete
												</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
