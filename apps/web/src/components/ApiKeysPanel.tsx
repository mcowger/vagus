import React, { useState } from "react";
import { KeyRound, Trash2, Copy, AlertCircle, CheckCircle2 } from "lucide-react";
import { trpc } from "../trpc";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export const ApiKeysPanel: React.FC = () => {
	const utils = trpc.useUtils();
	const keysQuery = trpc.apiKeys.list.useQuery();

	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [newKey, setNewKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const createMutation = trpc.apiKeys.create.useMutation({
		onSuccess: (data) => {
			setNewKey(data.key);
			setName("");
			setError("");
			utils.apiKeys.list.invalidate();
		},
		onError: (err) => setError(err.message || "Failed to create key."),
	});

	const revokeMutation = trpc.apiKeys.revoke.useMutation({
		onSuccess: () => utils.apiKeys.list.invalidate(),
		onError: (err) => setError(err.message || "Failed to revoke key."),
	});

	const handleCreate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		setError("");
		createMutation.mutate({ name: name.trim() });
	};

	const handleCopy = async () => {
		if (!newKey) return;
		await navigator.clipboard.writeText(newKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="h-5 w-5" /> API Keys
				</CardTitle>
				<CardDescription>
					Create keys for robot/API access. Keys act as the admin who created them.
					Send the key in the <code>x-api-key</code> header.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{error && (
					<div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
						<AlertCircle className="h-4 w-4" />
						<span>{error}</span>
					</div>
				)}

				{newKey && (
					<div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-2">
						<div className="font-semibold">
							Copy your new key now — it won't be shown again.
						</div>
						<div className="flex items-center gap-2">
							<code className="flex-1 break-all rounded bg-white px-2 py-1 border border-amber-200">
								{newKey}
							</code>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleCopy}
								className="flex items-center gap-1"
							>
								{copied ? (
									<CheckCircle2 className="h-3.5 w-3.5" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setNewKey(null)}
						>
							Dismiss
						</Button>
					</div>
				)}

				<form onSubmit={handleCreate} className="flex items-end gap-2">
					<div className="flex-1 space-y-2">
						<Label htmlFor="apikey-name">New key name</Label>
						<Input
							id="apikey-name"
							placeholder="e.g. ingest-robot"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<Button type="submit" disabled={createMutation.isPending || !name.trim()}>
						{createMutation.isPending ? "Creating..." : "Create key"}
					</Button>
				</form>

				<div className="space-y-2">
					{keysQuery.isLoading && (
						<p className="text-sm text-slate-500">Loading keys...</p>
					)}
					{keysQuery.data?.length === 0 && (
						<p className="text-sm text-slate-500">No API keys yet.</p>
					)}
					{keysQuery.data?.map((k) => (
						<div
							key={k.id}
							className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
						>
							<div className="min-w-0">
								<div className="font-medium text-slate-900 truncate">
									{k.name ?? "(unnamed)"}
								</div>
								<div className="text-xs text-slate-500">
									{k.start ? `${k.start}…` : "—"} · created{" "}
									{new Date(k.createdAt).toLocaleDateString()}
									{!k.enabled && " · disabled"}
								</div>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="flex items-center gap-1 text-red-600"
								onClick={() => revokeMutation.mutate({ keyId: k.id })}
								disabled={revokeMutation.isPending}
							>
								<Trash2 className="h-3.5 w-3.5" /> Revoke
							</Button>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
};
