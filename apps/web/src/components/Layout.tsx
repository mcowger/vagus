import React from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";
import { Button } from "./ui/button";

export const Layout: React.FC = () => {
	const { data: session } = useSession();
	const navigate = useNavigate();

	const handleSignOut = async () => {
		await signOut();
		navigate("/login");
	};

	return (
		<div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
			<header className="border-b border-slate-200 bg-white shadow-sm">
				<div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
					<div className="flex items-center gap-6">
						<Link to="/" className="text-xl font-bold tracking-tight text-slate-900 hover:text-slate-700">
							vagus
						</Link>
					</div>
					<div className="flex items-center gap-4">
						{session?.user ? (
							<>
								<span className="text-sm text-slate-600 font-medium">
									{session.user.email}
								</span>
								<Button variant="outline" size="sm" onClick={handleSignOut}>
									Sign out
								</Button>
							</>
						) : (
							<div className="flex items-center gap-2">
								<Link to="/login">
									<Button variant="ghost" size="sm">
										Sign in
									</Button>
								</Link>
								<Link to="/signup">
									<Button size="sm">
										Sign up
									</Button>
								</Link>
							</div>
						)}
					</div>
				</div>
			</header>

			<main className="flex-1 max-w-6xl w-full mx-auto p-6">
				<Outlet />
			</main>
		</div>
	);
};
