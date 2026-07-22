import { Type, type Static } from "@sinclair/typebox";

export const ClusterSummaryToolSchema = Type.Object({
	title: Type.String({ description: "Concise event headline for this cluster" }),
	summary: Type.String({ description: "Synthesized multi-sentence overview of the cluster" }),
	perspectives: Type.Array(Type.String(), {
		description: "Key perspectives, consensus, or differing viewpoints across sources",
	}),
	timeline: Type.Array(Type.String(), {
		description: "Chronological sequence of key events reported in sources",
	}),
	citations: Type.Array(Type.String(), {
		description: "Article keys referenced (e.g. ['art_1', 'art_2'])",
	}),
});

export type ClusterSummaryResult = Static<typeof ClusterSummaryToolSchema>;

export const DigestQuoteSchema = Type.Object({
	quote: Type.String({ description: "Direct noteworthy quote from an article" }),
	citation: Type.String({ description: "Article citation key (e.g. 'art_1')" }),
});

export const DigestToolSchema = Type.Object({
	executive_summary: Type.String({
		description: "High-level summary overview of all selected topics in this digest",
	}),
	key_takeaways: Type.Array(Type.String(), {
		description: "3-5 key actionable takeaways across all selected news stories",
	}),
	why_it_matters: Type.String({
		description: "Broad significance and impact for the user's domain/interests",
	}),
	key_quotes: Type.Array(DigestQuoteSchema, {
		description: "Selected verbatim quotes from primary sources with citations",
	}),
});

export type DigestResult = Static<typeof DigestToolSchema>;

/**
 * Filter out hallucinated citation keys that do not exist in the provided valid keys set.
 */
export function validateAndFilterCitations(
	citations: string[],
	validArticleKeys: Set<string>,
): string[] {
	if (!Array.isArray(citations)) return [];
	const valid = new Set<string>();
	for (const key of citations) {
		const cleanKey = typeof key === "string" ? key.trim() : "";
		if (cleanKey && validArticleKeys.has(cleanKey)) {
			valid.add(cleanKey);
		}
	}
	return Array.from(valid);
}
