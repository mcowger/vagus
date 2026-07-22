import React from "react";
import { trpc } from "../trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const Dashboard: React.FC = () => {
	const { data: session } = useSession();
	const pingQuery = trpc.ping.useQuery();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
				<p className="text-slate-500 mt-1">
					Welcome back, <span className="font-semibold text-slate-800">{session?.user?.name || session?.user?.email}</span>
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">User Profile</CardTitle>
						<CardDescription>Current authenticated session info</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="flex justify-between py-1 border-b border-slate-100">
							<span className="text-slate-500">Email:</span>
							<span className="font-mono">{session?.user?.email}</span>
						</div>
						<div className="flex justify-between py-1 border-b border-slate-100">
							<span className="text-slate-500">Name:</span>
							<span>{session?.user?.name || "N/A"}</span>
						</div>
						<div className="flex justify-between py-1">
							<span className="text-slate-500">User ID:</span>
							<span className="font-mono text-xs">{session?.user?.id}</span>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-lg">System Wiring & API Status</CardTitle>
						<CardDescription>Live check via tRPC ping query</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3 text-sm">
						{pingQuery.isLoading ? (
							<div className="flex items-center gap-2 text-slate-500">
								<span className="animate-spin">⏳</span> Ping tRPC API...
							</div>
						) : pingQuery.isError ? (
							<div className="p-3 bg-red-50 text-red-600 rounded-md border border-red-200">
								<strong>API Error:</strong> {pingQuery.error.message}
							</div>
						) : (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 p-2.5 rounded-md border border-emerald-200">
									<span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
									<span className="font-medium">tRPC connection operational</span>
								</div>
								<div className="flex justify-between py-1 border-b border-slate-100">
									<span className="text-slate-500">Ping Result:</span>
									<span className="font-mono text-emerald-600 font-semibold">{pingQuery.data?.ok ? "ok: true" : "failed"}</span>
								</div>
								<div className="flex justify-between py-1">
									<span className="text-slate-500">Server Timestamp:</span>
									<span className="font-mono text-xs">{pingQuery.data?.time ? new Date(pingQuery.data.time).toISOString() : "N/A"}</span>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
