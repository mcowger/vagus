import React, { useState } from "react";
import { jsonrepair } from "jsonrepair";
import { Link, useParams } from "react-router-dom";
import { trpc } from "../trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
	BookOpen,
	FileText,
	Layers,
	ExternalLink,
	Copy,
	Check,
	Code,
	Sparkles,
	Clock,
	Calendar,
	Download,
	X,
	ChevronRight,
	ThumbsUp,
	ThumbsDown,
} from "lucide-react";

function getDomainFromUrl(url?: string | null): string {
	if (!url) return "";
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function getFaviconUrl(url?: string | null): string {
	const domain = getDomainFromUrl(url);
	if (!domain) return "";
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function parseRawClusterSummary(raw?: string | null): {
	summary: string;
	perspectives?: string[];
	timeline?: string[];
} {
	if (!raw) return { summary: "" };
	let text = raw.trim();

	// Strip code fences if present
	if (text.startsWith("```") || text.includes("```json")) {
		text = text.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```$/i, "").trim();
	}

	if (text.startsWith("{")) {
		// 1. Direct or jsonrepair parse
		try {
			const repaired = jsonrepair(text);
			const obj = JSON.parse(repaired);
			if (obj && typeof obj === "object" && typeof obj.summary === "string" && obj.summary.trim()) {
				return {
					summary: obj.summary.trim(),
					perspectives: Array.isArray(obj.perspectives) ? obj.perspectives.map(String) : undefined,
					timeline: Array.isArray(obj.timeline) ? obj.timeline.map(String) : undefined,
				};
			}
		} catch {}

		// 2. Fallback Regex Extraction
		const summaryRegex = /(?:"summary"|summary)\s*:\s*"(.*?)"\s*,\s*(?:"perspectives"|perspectives|timeline|"timeline")/s;
		const match = text.match(summaryRegex) || text.match(/(?:"summary"|summary)\s*:\s*"((?:[^"\\]|\\.)*)"/s);
		if (match && match[1]) {
			const extractedSummary = match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
			if (extractedSummary) {
				return { summary: extractedSummary };
			}
		}
	}

	return { summary: text };
}

function cleanCodeFenceText(text?: string | null): string {
	if (!text) return "";
	return parseRawClusterSummary(text).summary;
}

export function stripCitationTags(text: string): string {
	return text
		.replace(/\s*\[(?:\s*art_\d+\s*)(?:,\s*art_\d+\s*)*\]/g, " ")
		.replace(/\s*\bart_\d+\b\s*/g, " ")
		.replace(/[;,]+(?=\s*[.!?])/g, "")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/** Helper to render inline text with markdown bold and colons. */
function InlineFormattedText({ text }: { text: string }) {
	if (!text) return null;

	const cleanText = stripCitationTags(cleanCodeFenceText(text));
	let titlePrefix = "";
	let bodyText = cleanText;

	// Check if line has a title colon near start without ** markdown
	if (!cleanText.startsWith("**")) {
		const colonMatch = cleanText.match(/^([A-Z][^:.]{2,45}):\s*(.*)$/s);
		if (colonMatch) {
			titlePrefix = colonMatch[1];
			bodyText = colonMatch[2];
		}
	}

	const tokenRegex = /(\*\*[^*]+\*\*)/g;
	const parts = bodyText.split(tokenRegex);

	return (
		<span>
			{titlePrefix && (
				<strong className="font-bold text-slate-900 mr-1.5">
					{titlePrefix}:
				</strong>
			)}
			{parts.map((part, idx) => {
				if (!part) return null;

				if (part.startsWith("**") && part.endsWith("**")) {
					const boldText = part.slice(2, -2);
					return (
						<strong key={idx} className="font-bold text-indigo-950 mr-0.5">
							{boldText}
						</strong>
					);
				}

				return <React.Fragment key={idx}>{part}</React.Fragment>;
			})}
		</span>
	);
}

/** Renders Executive Summary as structured trend bullet cards */
function ExecutiveSummaryContent({
	text,
}: { text: string }) {
	if (!text) return null;

	let lines: string[] = [];

	if (text.includes("\n") || /[•\-\*]\s+/.test(text)) {
		lines = text
			.split(/\n+|\s*(?=[•\-\*]\s+)/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
	} else {
		// Split multi-sentence summary into trend bullet cards
		const introAndSentences = text.split(/(?<=\.)\s+(?=[A-Z])/);
		lines = introAndSentences.map((s) => s.trim()).filter((s) => s.length > 0);
	}

	if (lines.length === 0) return null;

	return (
		<div className="space-y-2.5">
			{lines.map((line, idx) => {
				const cleanLine = line.replace(/^[•\-\*]\s*|^\d+\.\s*/, "").trim();
				if (!cleanLine) return null;

				return (
					<div
						key={idx}
						className="flex items-start gap-3 p-3 rounded-lg bg-indigo-50/25 border border-indigo-100/80 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all shadow-2xs"
					>
						<div className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-md bg-indigo-100 border border-indigo-200 text-indigo-700 flex items-center justify-center font-bold text-xs shadow-2xs">
							{idx + 1}
						</div>
						<div className="leading-relaxed text-sm text-slate-800 flex-1">
							<InlineFormattedText text={cleanLine} />
						</div>
					</div>
				);
			})}
		</div>
	);
}

export const DigestReader: React.FC = () => {
	const { id } = useParams<{ id?: string }>();
	const { data: session } = useSession();

	const [verbosityMode, setVerbosityMode] = useState<"tldr" | "deep">("deep");
	const [showJsonModal, setShowJsonModal] = useState(false);
	const [copied, setCopied] = useState(false);

	const utils = trpc.useUtils();
	const feedbackQuery = trpc.feedback.getFeedbackStats.useQuery(undefined, {
		enabled: Boolean(session?.user),
	});

	const voteClusterMutation = trpc.feedback.voteCluster.useMutation({
		onSuccess: () => {
			utils.feedback.getFeedbackStats.invalidate();
		},
	});

	const { data: digestsList, isLoading: isLoadingList } = trpc.digest.listPublic.useQuery();

	const routeDigestId = id ? parseInt(id, 10) : undefined;
	const activeDigestId = routeDigestId ?? (digestsList && digestsList.length > 0 ? digestsList[0].id : undefined);

	// Fetch detailed digest by id
	const { data: digest, isLoading: isLoadingDigest } = trpc.digest.getPublicById.useQuery(
		{ id: activeDigestId as number },
		{ enabled: !!activeDigestId && !isNaN(activeDigestId) } as any
	);

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
							Published Digests
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
									<Link
										key={d.id}
										to={`/digests/${d.id}`}
										className={`block w-full text-left p-3 rounded-lg border transition-all ${
											isSelected
												? "border-indigo-500 bg-indigo-50/60 shadow-sm"
												: "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
										}`}
									>
										<div className="flex items-center justify-between gap-1">
											<span className="text-xs font-mono font-bold text-indigo-600">
												Digest #{d.id}
											</span>
											<span className="text-[10px] text-slate-400 font-mono">
												Run #{d.run_id}
											</span>
										</div>
										<div className="mt-1">
											<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100/80 text-indigo-800 border border-indigo-200/60 inline-block mb-1">
												{d.profile_name || "General News"}
											</span>
											<p className="text-xs text-slate-700 font-medium line-clamp-2">
												{d.executive_summary || "Executive summary unavailable"}
											</p>
										</div>
										<div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2">
											<Clock className="h-3 w-3" />
											<span>{createdDate}</span>
										</div>
									</Link>
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
							No published digests are available yet.
							</p>
						</div>
					) : (
						<>
							{/* Digest Metadata Banner */}
							<div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
								<div>
									<div className="flex items-center gap-2 flex-wrap">
										<span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
											Digest #{digest.id}
										</span>
										<span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white border border-white/20">
											{digest.profile_name || "General News"}
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
									<ExecutiveSummaryContent text={digest.executive_summary} />
								</CardContent>
							</Card>

							{/* Story Clusters & Deep Dives */}
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

										const parsedCluster = parseRawClusterSummary(cluster.summary);
										const cleanSummary = parsedCluster.summary || cluster.summary;

										const clusterVote = feedbackQuery.data?.feedback?.[`cluster:${cluster.id}`] ?? 0;

										return (
											<Card key={cluster.id} className="border-slate-200 shadow-sm overflow-hidden">
												{/* Cluster Header */}
												<CardHeader className="bg-slate-50/80 border-b border-slate-100 py-3.5 px-5">
													<div className="flex items-start justify-between gap-3">
														<div>
															{clusterCitations.length > 0 && (
																<div className="flex items-center gap-2 mb-1.5">
																	<span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
																		{clusterCitations.length} source{clusterCitations.length > 1 ? "s" : ""}
																	</span>
																</div>
															)}
															<CardTitle className="text-base font-bold text-slate-900">
																{cluster.title}
															</CardTitle>
														</div>

														{session?.user && (
															<div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-2xs">
															<button
																type="button"
																title="Boost stories like this"
																onClick={() =>
																	voteClusterMutation.mutate({
																		clusterId: cluster.id,
																		vote: clusterVote === 1 ? 0 : 1,
																	})
																}
																className={`p-1.5 rounded-md transition-all ${
																	clusterVote === 1
																		? "bg-emerald-100 text-emerald-700 shadow-2xs font-bold"
																		: "text-slate-400 hover:text-emerald-600 hover:bg-slate-50"
																}`}
															>
																<ThumbsUp className="h-4 w-4" />
															</button>
															<button
																type="button"
																title="Deprioritize stories like this"
																onClick={() =>
																	voteClusterMutation.mutate({
																		clusterId: cluster.id,
																		vote: clusterVote === -1 ? 0 : -1,
																	})
																}
																className={`p-1.5 rounded-md transition-all ${
																	clusterVote === -1
																		? "bg-rose-100 text-rose-700 shadow-2xs font-bold"
																		: "text-slate-400 hover:text-rose-600 hover:bg-slate-50"
																}`}
															>
																<ThumbsDown className="h-4 w-4" />
															</button>
															</div>
														)}
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
																{getTldrBullets(cleanSummary).map((bullet, bIdx) => (
																	<li key={bIdx} className="flex items-start gap-2 text-sm text-slate-800 leading-relaxed">
																		<span className="text-indigo-500 font-bold">•</span>
																		<div>
																					<InlineFormattedText text={bullet} />
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
																	{cleanSummary.split("\n\n").map((paragraph, pIdx) => (
																		<p key={pIdx}>
																					<InlineFormattedText text={paragraph} />
																		</p>
																	))}
																</div>
															</div>
														</div>
													)}

													{/* Compact source citations */}
													{clusterCitations.length > 0 && (
														<div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
																<h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
																	<FileText className="h-3.5 w-3.5 text-slate-500" />
																	Sources ({clusterCitations.length})
																</h5>
																{clusterCitations.map((cit) => {
																	const domain = getDomainFromUrl(cit.article_url);
																	const favicon = getFaviconUrl(cit.article_url);

																	return (
																		<a
																			key={cit.id}
																			href={cit.article_url}
																			target="_blank"
																			rel="noopener noreferrer"
																			title={cit.article_title}
																			className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
																		>
																			{favicon && (
																				<img
																					src={favicon}
																					alt=""
																					className="h-3.5 w-3.5 flex-shrink-0 rounded-xs object-contain"
																					onError={(e) => {
																						(e.target as HTMLElement).style.display = "none";
																					}}
																				/>
																			)}
																			<span className="max-w-40 truncate">{domain || cit.citation_key}</span>
																			<ExternalLink className="h-3 w-3 flex-shrink-0" />
																		</a>
																	);
																})}
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
