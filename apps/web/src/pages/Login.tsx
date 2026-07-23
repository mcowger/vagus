import React, { useState } from "react";
import { signIn } from "../lib/auth-client";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const Login: React.FC = () => {
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleGoogleSignIn = async () => {
		setError(null);
		setLoading(true);
		try {
			// better-auth resolves with an { error } object (e.g. provider not
			// configured → 404) rather than throwing, so a successful redirect never
			// returns here. Surface any error and reset the button.
			const res = await signIn.social({ provider: "google", callbackURL: "/" });
			if (res?.error) {
				setError(
					res.error.message ||
						"Google sign-in is unavailable. Please contact an administrator.",
				);
				setLoading(false);
			}
		} catch (err: any) {
			setError(err?.message || "Failed to start Google sign-in");
			setLoading(false);
		}
	};

	return (
		<div className="flex items-center justify-center min-h-[70vh]">
			<Card className="w-full max-w-md shadow-lg">
				<CardHeader className="space-y-1">
					<CardTitle className="text-2xl font-bold">Sign in to vagus</CardTitle>
					<CardDescription>
						Use your Google account to access your news digests.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{error && (
						<div className="p-3 text-sm rounded-md bg-red-50 text-red-600 border border-red-200">
							{error}
						</div>
					)}
					<Button
						type="button"
						className="w-full"
						onClick={handleGoogleSignIn}
						disabled={loading}
					>
						{loading ? "Redirecting..." : "Sign in with Google"}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
};
