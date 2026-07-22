import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
	BookOpen,
	FileText,
	Layers,
	ListChecks,
	Lightbulb,
	Quote,
	ExternalLink,
	Copy,
	Check,
	Code,
	Sparkles,
	Clock,
	User,
	Calendar,
	Download,
	X,
	ChevronRight,
	Share2,
} from "lucide-react";

/** Helper to render inline text with citation chips [art_X] */
function TextWithCitations({ text }: { text: string }) {
	if (!text) return null;
	// Match [art_X] or art_X pattern
	const parts = text.split(/(\[art_\d+\]|art_\d+)/g);

	return (
		<span>
			{parts.map((part, idx) => {
				const isCitation = /^\[?art_\d+\]?$/.test(part);
				if (isCitation) {
					const cleanKey = part.replace(/^\[|\]$/g, "");
					return (
						<span
							key={idx}
							className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
						>
							{cleanKey}
						</span>
					);
				}
				return <React.Fragment key={idx}>{part}</React.Fragment>;
			})}
		</span>
	);
}

export const DigestReader: React.FC = () => {
	const { id } = useParams<{ id?: string }>();
	const navigate = useNavigate();

	const [verbosityMode, setVerbosityMode] = useState<"tldr" | "deep">("deep");
	const [showJsonModal, setShowJsonModal] = useState(false);
	const [copied, setCopied] = useState(false);

	// Fetch list of user digests
	const { data: digestsList, isLoading: isLoadingList } = trpc.digest.listForUser.useQuery();

	const routeDigestId = id ? parseInt(id, 10) : undefined;
	const activeDigestId = routeDigestId ?? (digestsList && digestsList.length > 0 ? digestsList[0].id : undefined);

	// Fetch detailed digest by id
	const { data: digest, isLoading: isLoadingDigest } = trpc.digest.getById.useQuery(
		{ id: activeDigestId as number },
		{ enabled: !!activeDigestId && !isNaN(activeDigestId) } as any
	);

	const handleSelectDigest = (digestId: number) => {
		navigate(`/digests/${digestId}`);
	};

	const handleCopyJson = () => {
		if (!digest) return;
		navigator.clipboard.writeText(JSON.stringify(digest, null, 2));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleDownloadJson = () => {
		if (!digest) return;
		const blob = new Blob([JSON.stringify(digest, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `digest-${digest.id}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	// Helper to split summary into concise bullet points for TL;DR view
	const getTldrBullets = (summary: string) => {
		if (!summary) return [];
		return summary
			.split(/(?<=\.|\n)\s+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 5);
	};

	// Parse quote list safely
	const normalizedQuotes = React.useMemo(() => {
		if (!digest?.key_quotes) return [];
		const raw = digest.key_quotes;
		if (Array.isArray(raw)) {
			return raw.map((item: any) => {
				if (typeof item === "string") return { quote: item, citation: "" };
				return { quote: item?.quote || "", citation: item?.citation || "" };
			});
		}
		return [];
	}, [digest?.key_quotes]);

	// Parse takeaways safely
	const normalizedTakeaways = React.useMemo(() => {
		if (!digest?.key_takeaways) return [];
		return Array.isArray(digest.key_takeaways) ? digest.key_takeaways : [String(digest.key_takeaways)];
	}, [digest?.key_takeaways]);

	return (
		<div className="space-y-6">
			{/* Top Header & Toolbar */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
				<div>
					<div className="flex items-center gap-2">
						<BookOpen className="h-7 w-7 text-indigo-600" />
						<h1 className="text-3xl font-bold tracking-tight text-slate-900">Digest Reader</h1>
					</div>
					<p className="text-slate-500 text-sm mt-1">
						Synthesized intelligence digests with deep dive analysis and source verification.
					</p>
				</div>

				{digest && (
					<div className="flex items-center gap-3 self-start md:self-auto">
						{/* Verbosity Toggle */}
						<div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200 text-xs font-semibold">
							<button
								type="button"
								onClick={() => setVerbosityMode("tldr")}
								className={`px-3 py-1.5 rounded-md transition-all ${
									verbosityMode === "tldr"
										? "bg-white text-indigo-700 shadow-sm font-bold"
										: "text-slate-600 hover:text-slate-900"
								}`}
							>
								⚡ TL;DR
							</button>
							<button
								type="button"
								onClick={() => setVerbosityMode("deep")}
								className={`px-3 py-1.5 rounded-md transition-all ${
									verbosityMode === "deep"
										? "bg-white text-indigo-700 shadow-sm font-bold"
										: "text-slate-600 hover:text-slate-900"
								}`}
							>
								🔍 Deep Dive
							</button>
						</div>

						{/* Export JSON Button */}
						<Button variant="outline" size="sm" onClick={() => setShowJsonModal(true)} className="gap-1.5">
							<Code className="h-4 w-4 text-slate-600" />
							Export JSON
						</Button>
					</div>
				)}
			</div>

			{/* Main Grid: Sidebar Digest List + Active Digest Content */}
			<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
				{/* Left Sidebar: Digest Selector List */}
				<div className="lg:col-span-1 space-y-3">
					<div className="flex items-center justify-between px-1">
						<span className="text-xs font-bold uppercase tracking-wider text-slate-500">
							Your Digests
						</span>
						<span className="text-xs font-mono text-slate-400">
							{digestsList?.length || 0} total
						</span>
					</div>

					{isLoadingList ? (
						<div className="p-4 bg-white rounded-lg border border-slate-200 text-sm text-slate-500 animate-pulse">
							Loading digests...
						</div>
					) : !digestsList || digestsList.length === 0 ? (
						<div className="p-4 bg-white rounded-lg border border-slate-200 text-sm text-slate-500 text-center">
							No digests generated yet.
						</div>
					) : (
						<div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
							{digestsList.map((d) => {
								const isSelected = d.id === activeDigestId;
								const createdDate = new Date(d.created_at).toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
									year: "numeric",
									hour: "2-digit",
									minute: "2-digit",
								});

								return (
									<button
										key={d.id}
										onClick={() => handleSelectDigest(d.id)}
										className={`w-full text-left p-3 rounded-lg border transition-all ${
											isSelected
												? "border-indigo-500 bg-indigo-50/60 shadow-sm"
												: "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
										}`}
									>
										<div className="flex items-center justify-between">
											<span className="text-xs font-mono font-bold text-indigo-600">
												Digest #{d.id}
											</span>
											<span className="text-[10px] text-slate-400 font-mono">
												Run #{d.run_id}
											</span>
										</div>
										<p className="text-xs text-slate-700 font-medium line-clamp-2 mt-1">
											{d.executive_summary || "Executive summary unavailable"}
										</p>
										<div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2">
											<Clock className="h-3 w-3" />
											<span>{createdDate}</span>
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>

				{/* Right Main Panel: Digest Detailed View */}
				<div className="lg:col-span-3 space-y-6">
					{isLoadingList || (activeDigestId && isLoadingDigest) ? (
						<div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-slate-500 space-y-3">
							<div className="animate-spin text-indigo-600 text-2xl">⏳</div>
							<p className="font-medium">Loading digest details...</p>
						</div>
					) : !activeDigestId || !digest ? (
						<div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-slate-500 space-y-3">
							<BookOpen className="h-12 w-12 text-slate-300 mx-auto" />
							<h3 className="text-lg font-semibold text-slate-800">No digests available</h3>
							<p className="text-sm text-slate-500 max-w-sm mx-auto">
								You haven't generated any digests yet. Trigger a manual run in the Runs tab or wait for the scheduled pipeline to create your first digest.
							</p>
						</div>
					) : (
						<>
							{/* Digest Metadata Banner */}
							<div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
								<div>
									<div className="flex items-center gap-2">
										<span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
											Digest #{digest.id}
										</span>
										<span className="text-xs text-slate-300 font-mono">
											Pipeline Run #{digest.run_id}
										</span>
									</div>
									<h2 className="text-xl font-bold tracking-tight mt-1.5">
										Intelligence Synthesis Report
									</h2>
								</div>
								<div className="text-xs text-slate-300 flex items-center gap-2 font-mono bg-white/10 px-3 py-1.5 rounded-lg self-start sm:self-auto">
									<Calendar className="h-3.5 w-3.5" />
									<span>{new Date(digest.created_at).toLocaleString()}</span>
								</div>
							</div>

							{/* Section 1: Executive Summary */}
							<Card className="border-indigo-100 shadow-sm">
								<CardHeader className="bg-gradient-to-r from-indigo-50/50 to-white pb-3">
									<CardTitle className="text-base font-bold flex items-center gap-2 text-indigo-900">
										<Sparkles className="h-5 w-5 text-indigo-600" />
										Executive Summary
									</CardTitle>
								</CardHeader>
								<CardContent className="pt-4 text-slate-800 leading-relaxed text-sm">
									<TextWithCitations text={digest.executive_summary} />
								</CardContent>
							</Card>

							{/* Section 2: Why It Matters & Key Takeaways Grid */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								{/* Why It Matters */}
								<Card className="border-amber-100 shadow-sm">
									<CardHeader className="bg-amber-50/50 pb-3">
										<CardTitle className="text-base font-bold flex items-center gap-2 text-amber-900">
											<Lightbulb className="h-5 w-5 text-amber-600" />
											Why It Matters
										</CardTitle>
									</CardHeader>
									<CardContent className="pt-4 text-slate-800 leading-relaxed text-sm">
										<TextWithCitations text={digest.why_it_matters} />
									</CardContent>
								</Card>

								{/* Key Takeaways */}
								<Card className="border-emerald-100 shadow-sm">
									<CardHeader className="bg-emerald-50/50 pb-3">
										<CardTitle className="text-base font-bold flex items-center gap-2 text-emerald-900">
											<ListChecks className="h-5 w-5 text-emerald-600" />
											Key Takeaways
										</CardTitle>
									</CardHeader>
									<CardContent className="pt-4 space-y-2 text-sm text-slate-800">
										{normalizedTakeaways.length === 0 ? (
											<p className="text-slate-400 italic">No key takeaways specified.</p>
										) : (
											normalizedTakeaways.map((takeaway, idx) => (
												<div key={idx} className="flex items-start gap-2.5">
													<span className="flex-shrink-0 mt-0.5 h-4 w-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">
														{idx + 1}
													</span>
													<div className="leading-snug">
														<TextWithCitations text={takeaway} />
													</div>
												</div>
											))
										)}
									</CardContent>
								</Card>
							</div>

							{/* Section 3: Key Quotes with Citation Badges */}
							{normalizedQuotes.length > 0 && (
								<Card className="border-slate-200 shadow-sm">
									<CardHeader className="bg-slate-50 pb-3">
										<CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
											<Quote className="h-5 w-5 text-indigo-600" />
											Key Quotes
										</CardTitle>
									</CardHeader>
									<CardContent className="pt-4 grid grid-cols-1 gap-3">
										{normalizedQuotes.map((q, idx) => (
											<blockquote
												key={idx}
												className="p-3.5 bg-slate-50/80 border-l-4 border-indigo-500 rounded-r-lg text-xs leading-relaxed text-slate-800 space-y-2"
											>
												<p className="italic font-serif text-sm text-slate-900">"{q.quote}"</p>
												{q.citation && (
													<div className="flex items-center gap-2 pt-1">
														<span className="text-[11px] text-slate-500 font-medium">Source:</span>
														<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
															{q.citation}
														</span>
													</div>
												)}
											</blockquote>
										))}
									</CardContent>
								</Card>
							)}

							{/* Section 4: Story Clusters & Deep Dives */}
							<div className="space-y-4 pt-2">
								<div className="flex items-center justify-between">
									<h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
										<Layers className="h-5 w-5 text-indigo-600" />
										Story Clusters ({digest.clusters?.length || 0})
									</h3>
									<span className="text-xs text-slate-500 font-medium">
										Mode: <strong className="text-indigo-700 capitalize">{verbosityMode}</strong>
									</span>
								</div>

								{!digest.clusters || digest.clusters.length === 0 ? (
									<Card>
										<CardContent className="p-6 text-center text-slate-500 text-sm">
											No story clusters associated with this digest.
										</CardContent>
									</Card>
								) : (
									digest.clusters.map((cluster) => {
										// Filter citations relevant to this cluster
										const clusterCitations = (digest.citations || []).filter(
											(c) => c.digest_cluster_id === cluster.id
										);

										const perspectives: string[] = Array.isArray(cluster.perspectives)
											? cluster.perspectives
											: [];
										const timeline: any[] = Array.isArray(cluster.timeline)
											? cluster.timeline
											: [];

										return (
											<Card key={cluster.id} className="border-slate-200 shadow-sm overflow-hidden">
												{/* Cluster Header */}
												<CardHeader className="bg-slate-50/80 border-b border-slate-100 py-3.5 px-5">
													<div className="flex items-start justify-between gap-3">
														<div>
															<div className="flex items-center gap-2 mb-1">
																<span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800">
																	Cluster #{cluster.cluster_id}
																</span>
																{clusterCitations.length > 0 && (
																	<span className="text-xs text-slate-500 font-mono">
																		{clusterCitations.length} source{clusterCitations.length > 1 ? "s" : ""}
																	</span>
																)}
															</div>
															<CardTitle className="text-base font-bold text-slate-900">
																{cluster.title}
															</CardTitle>
														</div>
													</div>
												</CardHeader>

												<CardContent className="p-5 space-y-5">
													{/* Viewport: TL;DR vs Deep Dive */}
													{verbosityMode === "tldr" ? (
														/* TL;DR View: Concise Bullet List */
														<div className="space-y-2">
															<h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
																<span>⚡ Key Cluster Points</span>
															</h4>
															<ul className="space-y-2">
																{getTldrBullets(cluster.summary).map((bullet, bIdx) => (
																	<li key={bIdx} className="flex items-start gap-2 text-sm text-slate-800 leading-relaxed">
																		<span className="text-indigo-500 font-bold">•</span>
																		<div>
																			<TextWithCitations text={bullet} />
																		</div>
																	</li>
																))}
															</ul>
														</div>
													) : (
														/* Deep Dive View: Full Summary, Perspectives, Timeline */
														<div className="space-y-5">
															{/* Multi-paragraph Summary */}
															<div className="space-y-2">
																<h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
																	Synthesized Summary
																</h4>
																<div className="text-sm text-slate-800 leading-relaxed space-y-3">
																	{cluster.summary.split("\n\n").map((paragraph, pIdx) => (
																		<p key={pIdx}>
																			<TextWithCitations text={paragraph} />
																		</p>
																	))}
																</div>
															</div>

															{/* Perspectives Section */}
															{perspectives.length > 0 && (
																<div className="p-4 bg-indigo-50/50 rounded-lg border border-indigo-100 space-y-2">
																	<h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
																		<Share2 className="h-3.5 w-3.5 text-indigo-600" />
																		Key Perspectives & Viewpoints
																	</h4>
																	<ul className="space-y-1.5 text-xs text-indigo-950">
																		{perspectives.map((persp, pIdx) => (
																			<li key={pIdx} className="flex items-start gap-2">
																				<ChevronRight className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
																				<span>
																					<TextWithCitations text={persp} />
																				</span>
																			</li>
																		))}
																	</ul>
																</div>
															)}

															{/* Timeline Section */}
															{timeline.length > 0 && (
																<div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
																	<h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
																		<Clock className="h-3.5 w-3.5 text-slate-500" />
																		Chronological Event Timeline
																	</h4>
																	<div className="relative border-l-2 border-indigo-300 ml-2 pl-4 space-y-3 text-xs">
																		{timeline.map((item, tIdx) => {
																			const eventText = typeof item === "string" ? item : item?.event || item?.description || JSON.stringify(item);
																			const dateText = typeof item === "object" && item?.date ? item.date : null;

																			return (
																				<div key={tIdx} className="relative">
																					<span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-500 border-2 border-white"></span>
																					{dateText && (
																						<div className="font-mono text-[10px] text-slate-400 font-semibold mb-0.5">
																							{dateText}
																						</div>
																					)}
																					<div className="text-slate-800">
																						<TextWithCitations text={eventText} />
																					</div>
																				</div>
																			);
																		})}
																	</div>
																</div>
															)}
														</div>
													)}

													{/* Per-Story Source List (Solar UX Style) */}
													{clusterCitations.length > 0 && (
														<div className="pt-4 border-t border-slate-100 space-y-3">
															<div className="flex items-center justify-between">
																<h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
																	<FileText className="h-3.5 w-3.5 text-slate-500" />
																	Sources & References ({clusterCitations.length})
																</h5>
															</div>

															<div className="grid grid-cols-1 gap-2">
																{clusterCitations.map((cit) => (
																	<div
																		key={cit.id}
																		className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
																	>
																		<div className="space-y-1">
																			<div className="flex items-center gap-2">
																				<span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
																					{cit.citation_key}
																				</span>
																				<a
																					href={cit.article_url}
																					target="_blank"
																					rel="noopener noreferrer"
																					className="font-semibold text-slate-900 hover:text-indigo-600 transition-colors line-clamp-1"
																				>
																					{cit.article_title}
																				</a>
																			</div>
																			<div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
																				{cit.article_author && (
																					<span className="flex items-center gap-1">
																						<User className="h-3 w-3" />
																						{cit.article_author}
																					</span>
																				)}
																				{cit.article_publish_date && (
																					<span className="flex items-center gap-1 font-mono">
																						<Calendar className="h-3 w-3" />
																						{new Date(cit.article_publish_date).toLocaleDateString()}
																					</span>
																				)}
																			</div>
																		</div>

																		<a
																			href={cit.article_url}
																			target="_blank"
																			rel="noopener noreferrer"
																			className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-indigo-50 text-indigo-700 font-medium border border-slate-200 hover:border-indigo-200 transition-colors self-start sm:self-auto flex-shrink-0"
																		>
																			<span>View Article</span>
																			<ExternalLink className="h-3 w-3" />
																		</a>
																	</div>
																))}
															</div>
														</div>
													)}
												</CardContent>
											</Card>
										);
									})
								)}
							</div>
						</>
					)}
				</div>
			</div>

			{/* Export JSON Modal */}
			{showJsonModal && digest && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
					<div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
						{/* Modal Header */}
						<div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
							<div className="flex items-center gap-2">
								<Code className="h-5 w-5 text-indigo-600" />
								<h3 className="font-bold text-slate-900 text-base">
									Digest #{digest.id} - Raw JSON Export
								</h3>
							</div>
							<button
								onClick={() => setShowJsonModal(false)}
								className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
							>
								<X className="h-5 w-5" />
							</button>
						</div>

						{/* Modal Content */}
						<div className="p-4 flex-1 overflow-y-auto bg-slate-950 text-slate-100 font-mono text-xs">
							<pre className="whitespace-pre-wrap break-words">
								{JSON.stringify(digest, null, 2)}
							</pre>
						</div>

						{/* Modal Footer */}
						<div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
							<span className="text-xs text-slate-500 font-mono">
								Size: {JSON.stringify(digest).length} bytes
							</span>
							<div className="flex items-center gap-2">
								<Button variant="outline" size="sm" onClick={handleDownloadJson} className="gap-1.5">
									<Download className="h-4 w-4" />
									Download .json
								</Button>
								<Button size="sm" onClick={handleCopyJson} className="gap-1.5">
									{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
									{copied ? "Copied!" : "Copy JSON"}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
