import React, { useEffect, useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Sliders, ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";

function arrayToString(val: string | string[] | null | undefined): string {
	if (!val) return "";
	if (Array.isArray(val)) return val.join(", ");
	try {
		const parsed = JSON.parse(val);
		if (Array.isArray(parsed)) return parsed.join(", ");
	} catch {
		// return as-is if not valid JSON
	}
	return val;
}

function stringToArray(val: string): string[] {
	return val
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export const Profiles: React.FC = () => {
	const utils = trpc.useUtils();
	const profileQuery = trpc.profiles.getProfile.useQuery();
	const feedbackQuery = trpc.feedback.getFeedbackStats.useQuery();

	const voteSourceMutation = trpc.feedback.voteSource.useMutation({
		onSuccess: () => {
			utils.feedback.getFeedbackStats.invalidate();
		},
	});

	const voteClusterMutation = trpc.feedback.voteCluster.useMutation({
		onSuccess: () => {
			utils.feedback.getFeedbackStats.invalidate();
		},
	});

	const [name, setName] = useState("Default Profile");
	const [keywords, setKeywords] = useState("");
	const [topics, setTopics] = useState("");
	const [entities, setEntities] = useState("");
	const [includeRules, setIncludeRules] = useState("");
	const [excludeRules, setExcludeRules] = useState("");
	const [similarityThreshold, setSimilarityThreshold] = useState(0.65);
	const [maxClusterCap, setMaxClusterCap] = useState(10);
	const [ntfyTopic, setNtfyTopic] = useState("");
	const [saveSuccess, setSaveSuccess] = useState(false);

	useEffect(() => {
		if (profileQuery.data) {
			const p = profileQuery.data;
			setName(p.name || "Default Profile");
			setKeywords(arrayToString(p.keywords));
			setTopics(arrayToString(p.topics));
			setEntities(arrayToString(p.entities));
			setIncludeRules(arrayToString(p.include_rules));
			setExcludeRules(arrayToString(p.exclude_rules));
			setSimilarityThreshold(p.similarity_threshold ?? 0.65);
			setMaxClusterCap(p.max_cluster_cap ?? 10);
			setNtfyTopic(p.ntfy_topic || "");
		}
	}, [profileQuery.data]);

	const updateProfileMutation = trpc.profiles.updateProfile.useMutation({
		onSuccess: () => {
			utils.profiles.getProfile.invalidate();
			setSaveSuccess(true);
			setTimeout(() => setSaveSuccess(false), 3000);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setSaveSuccess(false);

		updateProfileMutation.mutate({
			name: name.trim() || "Default Profile",
			keywords: stringToArray(keywords),
			topics: stringToArray(topics),
			entities: stringToArray(entities),
			include_rules: stringToArray(includeRules),
			exclude_rules: stringToArray(excludeRules),
			similarity_threshold: Number(similarityThreshold),
			max_cluster_cap: Number(maxClusterCap),
			ntfy_topic: ntfyTopic.trim() || null,
		});
	};

	if (profileQuery.isLoading) {
		return <div className="text-slate-500 py-8">Loading interest profile...</div>;
	}

	return (
		<div className="space-y-6 max-w-4xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">Interest Profile</h1>
				<p className="text-slate-500 mt-1">
					Configure your interest criteria, topic rules, scoring threshold, and push notification topic.
				</p>
			</div>

			{saveSuccess && (
				<div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
					Profile saved successfully!
				</div>
			)}

			<form onSubmit={handleSubmit} className="space-y-6">
				{/* Identity & Push Notification */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Profile Identity & Push Topic</CardTitle>
						<CardDescription>Name your profile and configure your ntfy.sh topic</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="name">Profile Name</Label>
								<Input
									id="name"
									placeholder="e.g. Primary Tech Digest"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="ntfyTopic">ntfy.sh Topic Name</Label>
								<Input
									id="ntfyTopic"
									placeholder="e.g. my-custom-digest-topic"
									value={ntfyTopic}
									onChange={(e) => setNtfyTopic(e.target.value)}
								/>
								<p className="text-xs text-slate-500">
									Optional topic for ntfy push notifications when new digests arrive.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Interest Vectors (Keywords, Topics, Entities) */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Interest Criteria</CardTitle>
						<CardDescription>
							Optional vector embedding and lexical search criteria to prioritize stories matching your focus.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-100 text-xs text-emerald-950 space-y-1.5">
							<div className="font-semibold text-emerald-900 flex items-center gap-1.5">
								<span>💡 What happens if left blank? (Broad Curator Mode)</span>
							</div>
							<p className="leading-relaxed">
								You don't need to know what you want to read in advance! If you leave these fields empty, Vagus operates in <strong>Broad Curator Mode</strong> — digesting and summarizing the top story clusters across all your configured sources without filtering out topics.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="keywords">Keywords</Label>
							<Input
								id="keywords"
								placeholder="e.g. artificial intelligence, LLM, rust, webassembly"
								value={keywords}
								onChange={(e) => setKeywords(e.target.value)}
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>Specific Terms:</strong> Comma-separated technical terms or jargon. Matching terms boost story cluster scores (+0.1 bonus per match) and shape vector similarity.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="topics">Topics</Label>
							<Input
								id="topics"
								placeholder="e.g. Machine Learning, Cloud Architecture, Open Source"
								value={topics}
								onChange={(e) => setTopics(e.target.value)}
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>High-Level Domains:</strong> Comma-separated thematic categories to guide semantic vector matching for broad story selection.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="entities">Entities</Label>
							<Input
								id="entities"
								placeholder="e.g. OpenAI, Anthropic, Apple, Google, Meta"
								value={entities}
								onChange={(e) => setEntities(e.target.value)}
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>Organizations & Brands:</strong> Comma-separated names of specific companies, products, or people to highlight when mentioned in articles.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Hard Include & Exclude Rules */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Include & Exclude Rules</CardTitle>
						<CardDescription>
							Deterministic keyword filters that force or block story cluster selection regardless of vector similarity scores.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="p-3.5 rounded-lg bg-blue-50/60 border border-blue-100 text-xs text-blue-950 space-y-1.5">
							<div className="font-semibold text-blue-900 flex items-center gap-1.5">
								<span>💡 How Rule Filtering Works</span>
							</div>
							<p className="leading-relaxed">
								Rules are evaluated against the synthesized title and content of each story cluster during the scoring phase of a pipeline run.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="includeRules">Include Rules (Force Match)</Label>
							<Input
								id="includeRules"
								placeholder="e.g. breakthrough, release, open source"
								value={includeRules}
								onChange={(e) => setIncludeRules(e.target.value)}
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>Force Include:</strong> Comma-separated terms. Any story cluster containing these words/phrases will be automatically selected for your digest, bypassing vector similarity checks (unless blocked by an exclude rule).
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="excludeRules">Exclude Rules (Block Match)</Label>
							<Input
								id="excludeRules"
								placeholder="e.g. crypto, NFT, sponsored, job post"
								value={excludeRules}
								onChange={(e) => setExcludeRules(e.target.value)}
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>Hard Block:</strong> Comma-separated terms. Any story cluster containing these words/phrases is immediately discarded and will never appear in your digest, regardless of its vector relevance score.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Clustering & Scoring Settings */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Scoring & Clustering Settings</CardTitle>
						<CardDescription>
							Adjust vector embedding cosine similarity thresholds and cluster limits for digest synthesis.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="p-3.5 rounded-lg bg-indigo-50/60 border border-indigo-100 text-xs text-indigo-950 space-y-1.5">
							<div className="font-semibold text-indigo-900 flex items-center gap-1.5">
								<span>🧠 Vector Scoring & Threshold Tuning</span>
							</div>
							<p className="leading-relaxed">
								Your Interest Criteria (keywords, topics, entities) are compiled into a dense vector embedding representation. During each pipeline run, story cluster embeddings are compared against your profile using cosine similarity (0.00 to 1.00).
							</p>
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="similarityThreshold">
									Similarity Threshold ({similarityThreshold.toFixed(2)})
								</Label>
								<span className="text-xs text-slate-600 font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
									{similarityThreshold < 0.5 ? "Low (Broader Matching)" : similarityThreshold > 0.8 ? "High (Strict Direct Match)" : "Balanced Relevance"}
								</span>
							</div>
							<input
								id="similarityThreshold"
								type="range"
								min="0.0"
								max="1.0"
								step="0.05"
								value={similarityThreshold}
								onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
								className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
							/>
							<div className="flex justify-between text-xs text-slate-400 font-mono pt-0.5">
								<span>0.00 (Loose / Broad)</span>
								<span>0.50 (Default)</span>
								<span>1.00 (Exact Semantic)</span>
							</div>
							<p className="text-xs text-slate-500 leading-relaxed pt-1">
								<strong>Threshold Controls:</strong> Sets the minimum similarity score required for a story cluster to qualify for your digest. Lower values (e.g. <code>0.40 - 0.60</code>) capture broader industry context; higher values (e.g. <code>0.75 - 0.90</code>) require strict topical alignment.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="maxClusterCap">Max Cluster Cap</Label>
							<Input
								id="maxClusterCap"
								type="number"
								min={1}
								max={100}
								value={maxClusterCap}
								onChange={(e) => setMaxClusterCap(parseInt(e.target.value, 10) || 1)}
								required
							/>
							<p className="text-xs text-slate-500 leading-relaxed">
								<strong>Digest Size Limit:</strong> Maximum number of top-scoring story clusters included in a single briefing digest cycle (e.g. top 10 stories), keeping daily reports concise and focused.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Source Weightings & Feedback Adaptation Card */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Sliders className="h-5 w-5 text-indigo-600" />
							Source Weightings & Preference Adaptation
						</CardTitle>
						<CardDescription>
							Active source score multipliers and topic preferences learned from your thumbs up/down votes.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						{feedbackQuery.isLoading ? (
							<p className="text-xs text-slate-500">Loading adaptation preferences...</p>
						) : (
							<>
								{/* Preference Vector Active Badges */}
								<div className="flex flex-wrap items-center gap-2">
									{feedbackQuery.data?.hasPositiveVector ? (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
											<ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />
											Active Positive Preference Vector (Boosts Liked Topics)
										</span>
									) : null}
									{feedbackQuery.data?.hasNegativeVector ? (
										<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200 shadow-2xs">
											<ThumbsDown className="h-3.5 w-3.5 text-rose-600" />
											Active Negative Vector (Suppresses Disliked Topics)
										</span>
									) : null}
									{!feedbackQuery.data?.hasPositiveVector && !feedbackQuery.data?.hasNegativeVector && (
										<span className="text-xs text-slate-400 italic">
											No topic preference vectors trained yet. Vote thumbs up or down on stories in Digest Reader to adapt topic scoring.
										</span>
									)}
								</div>

								{/* Sub-section 1: Story Cluster Feedback */}
								<div className="space-y-2">
									<h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
										<span>Story Topic Feedback ({feedbackQuery.data?.clusterFeedback?.length || 0})</span>
									</h4>

									{!feedbackQuery.data?.clusterFeedback || feedbackQuery.data.clusterFeedback.length === 0 ? (
										<div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
											No story topic votes recorded yet.
										</div>
									) : (
										<div className="space-y-2">
											{feedbackQuery.data.clusterFeedback.map((cf) => (
												<div
													key={cf.id}
													className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white text-xs gap-3"
												>
													<div className="flex items-center gap-2 flex-1 min-w-0">
														{cf.vote === 1 ? (
															<span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex-shrink-0 flex items-center gap-1">
																<ThumbsUp className="h-3 w-3" /> Boosted
															</span>
														) : (
															<span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex-shrink-0 flex items-center gap-1">
																<ThumbsDown className="h-3 w-3" /> Suppressed
															</span>
														)}
														<span className="font-semibold text-slate-800 truncate">{cf.title}</span>
													</div>

													<Button
														type="button"
														variant="ghost"
														size="sm"
														onClick={() => voteClusterMutation.mutate({ clusterId: Number(cf.clusterId), vote: 0 })}
														className="text-[11px] text-slate-500 hover:text-slate-800 h-7 px-2 gap-1 flex-shrink-0"
													>
														<RotateCcw className="h-3 w-3" />
														Clear Vote
													</Button>
												</div>
											))}
										</div>
									)}
								</div>

								{/* Sub-section 2: Source Weight Multipliers */}
								<div className="space-y-2 pt-2 border-t border-slate-100">
									<h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
										<span>Source Weight Overrides ({feedbackQuery.data?.sourceWeights?.length || 0})</span>
									</h4>

									{!feedbackQuery.data?.sourceWeights || feedbackQuery.data.sourceWeights.length === 0 ? (
										<div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
											No custom source weightings configured yet. Use the thumbs up/down buttons on sources in the Sources tab to adjust weights.
										</div>
									) : (
										<div className="space-y-2">
											{feedbackQuery.data.sourceWeights.map((sw) => {
												let statusPill = `${sw.weight.toFixed(1)}x`;
												let statusClass = "bg-slate-100 text-slate-700 border-slate-200";

												if (sw.weight <= 0.1) {
													statusPill = "0.0x (Muted)";
													statusClass = "bg-rose-100 text-rose-800 border-rose-200 font-bold";
												} else if (sw.weight > 1.0) {
													statusPill = `${sw.weight.toFixed(1)}x (Boosted)`;
													statusClass = "bg-emerald-100 text-emerald-800 border-emerald-200 font-bold";
												} else if (sw.weight < 1.0) {
													statusPill = `${sw.weight.toFixed(1)}x (Lowered)`;
													statusClass = "bg-amber-100 text-amber-800 border-amber-200 font-bold";
												}

												return (
													<div
														key={sw.source_id}
														className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white text-xs"
													>
														<div className="flex items-center gap-2">
															<span className="font-semibold text-slate-800">{sw.source_name}</span>
															<span className={`px-2 py-0.5 rounded-full border text-[11px] ${statusClass}`}>
																{statusPill}
															</span>
														</div>

														<Button
															type="button"
															variant="ghost"
															size="sm"
															onClick={() => voteSourceMutation.mutate({ sourceId: sw.source_id, vote: 0 })}
															className="text-[11px] text-slate-500 hover:text-slate-800 h-7 px-2 gap-1"
														>
															<RotateCcw className="h-3 w-3" />
															Reset Weight
														</Button>
													</div>
												);
											})}
										</div>
									)}
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<div className="flex items-center justify-end gap-4 pt-2">
					<Button type="submit" size="lg" disabled={updateProfileMutation.isPending}>
						{updateProfileMutation.isPending ? "Saving Profile..." : "Save Interest Profile"}
					</Button>
				</div>
			</form>
		</div>
	);
};
