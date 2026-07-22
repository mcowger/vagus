import React, { useEffect, useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
							Enter comma-separated values to construct your profile vector and lexical match filters.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="keywords">Keywords</Label>
							<Input
								id="keywords"
								placeholder="e.g. artificial intelligence, LLM, rust, webassembly"
								value={keywords}
								onChange={(e) => setKeywords(e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="topics">Topics</Label>
							<Input
								id="topics"
								placeholder="e.g. Machine Learning, Cloud Architecture, Open Source"
								value={topics}
								onChange={(e) => setTopics(e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="entities">Entities</Label>
							<Input
								id="entities"
								placeholder="e.g. OpenAI, Anthropic, Apple, Google, Meta"
								value={entities}
								onChange={(e) => setEntities(e.target.value)}
							/>
						</div>
					</CardContent>
				</Card>

				{/* Hard Include & Exclude Rules */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Include & Exclude Rules</CardTitle>
						<CardDescription>
							Hard rules for forcing or filtering out clusters during relevance scoring.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="includeRules">Include Rules (Force Match)</Label>
							<Input
								id="includeRules"
								placeholder="e.g. breakthrough, release, open source"
								value={includeRules}
								onChange={(e) => setIncludeRules(e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="excludeRules">Exclude Rules (Block Match)</Label>
							<Input
								id="excludeRules"
								placeholder="e.g. crypto, NFT, sponsored, job post"
								value={excludeRules}
								onChange={(e) => setExcludeRules(e.target.value)}
							/>
						</div>
					</CardContent>
				</Card>

				{/* Clustering & Scoring Settings */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Scoring & Clustering Settings</CardTitle>
						<CardDescription>
							Adjust vector similarity thresholds and cluster limits for digest selection.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="similarityThreshold">
									Similarity Threshold ({similarityThreshold.toFixed(2)})
								</Label>
								<span className="text-xs text-slate-500 font-mono">
									{similarityThreshold < 0.5 ? "Low (More Clusters)" : similarityThreshold > 0.8 ? "High (Strict Match)" : "Balanced"}
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
							<div className="flex justify-between text-xs text-slate-400 font-mono">
								<span>0.00</span>
								<span>0.50</span>
								<span>1.00</span>
							</div>
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
							<p className="text-xs text-slate-500">
								Maximum number of top-scoring clusters included in a single digest cycle.
							</p>
						</div>
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
