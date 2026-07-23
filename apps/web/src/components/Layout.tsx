import React from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";
import { Button } from "./ui/button";

const navigationItems = [
	["/sources", "Sources"],
	["/profiles", "Profiles"],
	["/providers", "Providers"],
	["/task-models", "Task Models"],
	["/usage", "Usage & Costs"],
	["/runs", "Runs"],
	["/digests", "Digest Reader"],
	["/admin/settings", "Admin Settings"],
] as const;

export const Layout: React.FC = () => {
	const { data: session } = useSession();
	const navigate = useNavigate();
	const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false);

	const handleSignOut = async () => {
		await signOut();
		navigate("/login");
	};

	return (
		<div className="min-h-screen w-full bg-slate-50 text-slate-900 flex flex-col">
			<header className="border-b border-slate-200 bg-white shadow-sm">
				<div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
					<div className="flex items-center gap-6 min-w-0">
						<Link to="/" className="text-xl font-bold tracking-tight text-slate-900 hover:text-slate-700">
							vagus
						</Link>
						{session?.user && (
							<nav className="hidden xl:flex items-center gap-4 text-sm font-medium">
								{navigationItems.map(([to, label]) => (
									<Link key={to} to={to} className="text-slate-600 hover:text-slate-900">
										{label}
									</Link>
								))}
							</nav>
						)}
					</div>
					<div className="flex items-center gap-4">
						{session?.user ? (
							<>
								<button
									type="button"
									className="xl:hidden text-sm font-medium text-slate-600 hover:text-slate-900"
									onClick={() => setIsMobileNavOpen((isOpen) => !isOpen)}
									aria-expanded={isMobileNavOpen}
									aria-controls="mobile-navigation"
								>
									Menu
								</button>
								<span className="hidden xl:block text-sm text-slate-600 font-medium">
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
				{session?.user && isMobileNavOpen && (
					<nav id="mobile-navigation" className="xl:hidden border-t border-slate-200">
						<div className="max-w-6xl mx-auto grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-sm font-medium">
							{navigationItems.map(([to, label]) => (
								<Link
									key={to}
									to={to}
									className="rounded-md px-2 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
									onClick={() => setIsMobileNavOpen(false)}
								>
									{label}
								</Link>
							))}
						</div>
					</nav>
				)}
			</header>

			<main className="flex-1 max-w-6xl w-full mx-auto p-6">
				<Outlet />
			</main>
		</div>
	);
};
