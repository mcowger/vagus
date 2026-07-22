import React, { useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const PROVIDER_PRESETS = [
	{ name: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
	{ name: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1" },
	{ name: "groq", label: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1" },
	{ name: "ollama", label: "Ollama (Local)", defaultBaseUrl: "http://localhost:11434/v1" },
	{ name: "custom", label: "Custom OpenAI-Compatible", defaultBaseUrl: "http://localhost:8000/v1" },
];

export const Providers: React.FC = () => {
	const utils = trpc.useUtils();
	const providersQuery = trpc.providers.list.useQuery();

	const upsertProviderMutation = trpc.providers.upsert.useMutation({
		onSuccess: () => {
			utils.providers.list.invalidate();
			resetLlmForm();
		},
	});

	const deleteProviderMutation = trpc.providers.delete.useMutation({
		onSuccess: () => utils.providers.list.invalidate(),
	});

	// LLM Provider Form State
	const [selectedPreset, setSelectedPreset] = useState("openai");
	const [customProviderName, setCustomProviderName] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
	const [isCustomPreset, setIsCustomPreset] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);

	// Brave API Form State
	const [braveKey, setBraveKey] = useState("");

	const braveProvider = providersQuery.data?.find((p) => p.provider === "brave-news");

	const activeProviderName = isCustomPreset ? customProviderName.trim() : selectedPreset;

	const resetLlmForm = () => {
		setEditingId(null);
		setApiKey("");
		setIsCustomPreset(false);
		setSelectedPreset("openai");
		setCustomProviderName("");
		setBaseUrl("https://api.openai.com/v1");
	};

	const handlePresetChange = (presetName: string) => {
		setSelectedPreset(presetName);
		if (presetName === "custom") {
			setIsCustomPreset(true);
			setBaseUrl("http://localhost:8000/v1");
		} else {
			setIsCustomPreset(false);
			const preset = PROVIDER_PRESETS.find((p) => p.name === presetName);
			if (preset) {
				setBaseUrl(preset.defaultBaseUrl);
			}
		}
	};

	const handleSaveLlmProvider = (e: React.FormEvent) => {
		e.preventDefault();
		if (!activeProviderName) return;

		const configObj: Record<string, string> = {};
		if (baseUrl.trim()) {
			configObj.baseUrl = baseUrl.trim();
		}

		upsertProviderMutation.mutate({
			provider: activeProviderName,
			apiKey: apiKey.trim() || null,
			enabled: true,
			config: Object.keys(configObj).length > 0 ? JSON.stringify(configObj) : null,
		});
	};

	const handleSaveBrave = (e: React.FormEvent) => {
		e.preventDefault();
		if (!braveKey) return;
		upsertProviderMutation.mutate({
			provider: "brave-news",
			apiKey: braveKey.trim(),
			enabled: true,
		});
		setBraveKey("");
	};

	const handleEditProvider = (p: {
		id: number;
		provider: string;
		api_key: string | null;
		config: string | null;
	}) => {
		setEditingId(p.id);
		let parsedBaseUrl = "";
		if (p.config) {
			try {
				const parsed = JSON.parse(p.config);
				parsedBaseUrl = parsed.baseUrl || "";
			} catch {}
		}

		const isStandardPreset = PROVIDER_PRESETS.some((preset) => preset.name === p.provider);
		if (isStandardPreset) {
			setIsCustomPreset(false);
			setSelectedPreset(p.provider);
		} else {
			setIsCustomPreset(true);
			setCustomProviderName(p.provider);
		}

		setBaseUrl(parsedBaseUrl);
		setApiKey(""); // Keep existing API key if left blank
	};

	const llmProviders = providersQuery.data?.filter((p) => p.provider !== "brave-news") || [];

	return (
		<div className="space-y-8 max-w-4xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">Provider & API Keys</h1>
				<p className="text-slate-500 mt-1">
					Configure LLM providers, custom OpenAI-compatible endpoints, base URLs, and external search credentials.
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-3">
				{/* Configure LLM Provider Form */}
				<Card className="md:col-span-1">
					<CardHeader>
						<CardTitle className="text-lg">
							{editingId ? "Edit LLM Provider" : "Add LLM Provider"}
						</CardTitle>
						<CardDescription>Configure base URL and API key for AI models</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSaveLlmProvider} className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label htmlFor="providerSelect">Provider</Label>
									<button
										type="button"
										onClick={() => setIsCustomPreset(!isCustomPreset)}
										className="text-xs text-slate-500 hover:text-slate-900 underline"
									>
										{isCustomPreset ? "Select standard" : "Custom provider"}
									</button>
								</div>

								{isCustomPreset ? (
									<Input
										id="customProvider"
										placeholder="e.g. ollama, vllm, my-local-llm"
										value={customProviderName}
										onChange={(e) => setCustomProviderName(e.target.value)}
										required
									/>
								) : (
									<select
										id="providerSelect"
										value={selectedPreset}
										onChange={(e) => handlePresetChange(e.target.value)}
										className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors"
									>
										{PROVIDER_PRESETS.map((p) => (
											<option key={p.name} value={p.name}>
												{p.label}
											</option>
										))}
									</select>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="baseUrl">Base URL Endpoint</Label>
								<Input
									id="baseUrl"
									type="url"
									placeholder="https://api.openai.com/v1"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
								/>
								<p className="text-[11px] text-slate-500">
									OpenAI-compatible endpoint root (e.g., <code>http://localhost:11434/v1</code>)
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="apiKey">API Key / Secret Token</Label>
								<Input
									id="apiKey"
									type="password"
									placeholder={editingId ? "Leave blank to keep existing key" : "Enter API key"}
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
								/>
								<p className="text-[11px] text-slate-500">
									Optional for local models (e.g. Ollama/LM Studio)
								</p>
							</div>

							<div className="flex items-center gap-2 pt-2">
								<Button
									type="submit"
									className="flex-1"
									disabled={upsertProviderMutation.isPending || !activeProviderName}
								>
									{upsertProviderMutation.isPending
										? "Saving..."
										: editingId
										? "Update Provider"
										: "Save Provider"}
								</Button>
								{editingId && (
									<Button type="button" variant="outline" onClick={resetLlmForm}>
										Cancel
									</Button>
								)}
							</div>
						</form>
					</CardContent>
				</Card>

				{/* Active LLM Provider List */}
				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-lg">Configured LLM Providers</CardTitle>
						<CardDescription>Available endpoint targets for task execution</CardDescription>
					</CardHeader>
					<CardContent>
						{providersQuery.isLoading ? (
							<div className="text-slate-500 py-4">Loading provider configurations...</div>
						) : llmProviders.length === 0 ? (
							<div className="text-slate-500 py-6 text-center border rounded-md border-dashed">
								No custom LLM providers configured. Standard default models will use environment fallbacks.
							</div>
						) : (
							<div className="space-y-3">
								{llmProviders.map((p) => {
									let parsedUrl = "";
									if (p.config) {
										try {
											const parsed = JSON.parse(p.config);
											parsedUrl = parsed.baseUrl || "";
										} catch {}
									}

									return (
										<div
											key={p.id}
											className="flex items-center justify-between p-3.5 border border-slate-200 rounded-lg bg-white shadow-sm"
										>
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<span className="font-bold text-slate-900 capitalize">
														{p.provider}
													</span>
													{p.api_key ? (
														<span className="text-[10px] px-2 py-0.5 rounded font-mono bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
															API Key Set
														</span>
													) : (
														<span className="text-[10px] px-2 py-0.5 rounded font-mono bg-amber-50 text-amber-700 font-semibold border border-amber-200">
															No Key (Local/Public)
														</span>
													)}
												</div>
												{parsedUrl && (
													<div className="text-xs text-slate-500 font-mono">
														URL: <span className="text-slate-700">{parsedUrl}</span>
													</div>
												)}
											</div>

											<div className="flex items-center gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => handleEditProvider(p)}
												>
													Edit
												</Button>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => deleteProviderMutation.mutate({ id: p.id })}
													disabled={deleteProviderMutation.isPending}
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

			{/* Search / Source Provider Section */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Brave News Search API</CardTitle>
					<CardDescription>
						Credentials for fetching search results and live web articles
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSaveBrave} className="space-y-4 max-w-md">
						<div className="space-y-2">
							<Label htmlFor="braveKey">Brave Search / News API Key</Label>
							<Input
								id="braveKey"
								type="password"
								placeholder={
									braveProvider?.api_key ? "••••••••••••••••" : "BSA..."
								}
								value={braveKey}
								onChange={(e) => setBraveKey(e.target.value)}
							/>
						</div>

						<div className="flex items-center justify-between pt-2">
							<div className="text-xs text-slate-500">
								Status:{" "}
								{braveProvider?.api_key ? (
									<span className="text-emerald-600 font-semibold">Configured</span>
								) : (
									<span className="text-amber-600 font-semibold">Not Configured</span>
								)}
							</div>
							<Button
								type="submit"
								disabled={upsertProviderMutation.isPending || !braveKey}
							>
								{upsertProviderMutation.isPending ? "Saving..." : "Save Key"}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
};
