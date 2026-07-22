import React, { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./trpc";
import { useSession } from "./lib/auth-client";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Dashboard } from "./pages/Dashboard";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { data: session, isPending } = useSession();

	if (isPending) {
		return (
			<div className="flex items-center justify-center min-h-[50vh] text-slate-500">
				Loading session...
			</div>
		);
	}

	if (!session?.user) {
		return <Navigate to="/login" replace />;
	}

	return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
	const { data: session, isPending } = useSession();

	if (isPending) {
		return (
			<div className="flex items-center justify-center min-h-[50vh] text-slate-500">
				Loading session...
			</div>
		);
	}

	if (session?.user) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

export function App() {
	const [queryClient] = useState(() => new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 5000,
				refetchOnWindowFocus: false,
			},
		},
	}));

	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [
				httpBatchLink({
					url: "/trpc",
				}),
			],
		}),
	);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<BrowserRouter>
					<Routes>
						<Route path="/" element={<Layout />}>
							<Route
								index
								element={
									<ProtectedRoute>
										<Dashboard />
									</ProtectedRoute>
								}
							/>
							<Route
								path="login"
								element={
									<PublicRoute>
										<Login />
									</PublicRoute>
								}
							/>
							<Route
								path="signup"
								element={
									<PublicRoute>
										<Signup />
									</PublicRoute>
								}
							/>
							<Route path="*" element={<Navigate to="/" replace />} />
						</Route>
					</Routes>
				</BrowserRouter>
			</QueryClientProvider>
		</trpc.Provider>
	);
}
