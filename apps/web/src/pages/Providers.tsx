import React, { useState } from "react";
import { trpc } from "../trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export const Providers: React.FC = () => {
	const utils = trpc.useUtils();
	const providersQuery = trpc.providers.list.useQuery();
	const upsertProviderMutation = trpc.providers.upsert.useMutation({
		onSuccess: () => utils.providers.list.invalidate(),
	});

	const [braveKey, setBraveKey] = useState("");

	const handleSaveBrave = (e: React.FormEvent) => {
		e.preventDefault();
		upsertProviderMutation.mutate({
			provider: "brave-news",
			apiKey: braveKey,
			enabled: true,
		});
	};

	const braveProvider = providersQuery.data?.find((p) => p.provider === "brave-news");

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">Provider Keys</h1>
				<p className="text-slate-500 mt-1">Manage external API integrations and secret credentials.</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Brave News API</CardTitle>
					<CardDescription>Required for searching and fetching Brave News items</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSaveBrave} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="braveKey">API Key</Label>
							<Input
								id="braveKey"
								type="password"
								placeholder={braveProvider?.api_key ? "••••••••••••••••" : "Enter Brave Search/News API Key"}
								value={braveKey}
								onChange={(e) => setBraveKey(e.target.value)}
							/>
						</div>

						<div className="flex items-center justify-between pt-2">
							<div className="text-xs text-slate-500">
								Status: {braveProvider?.api_key ? (
									<span className="text-emerald-600 font-semibold">Configured</span>
								) : (
									<span className="text-amber-600 font-semibold">Not Configured</span>
								)}
							</div>
							<Button type="submit" disabled={upsertProviderMutation.isPending || !braveKey}>
								{upsertProviderMutation.isPending ? "Saving..." : "Save Key"}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
};
