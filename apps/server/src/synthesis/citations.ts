import type { Insertable } from "kysely";
import type { CitationTable } from "../db/schema";

/**
 * Uses regex matching (`\bart_\d+\b` or `\[art_\d+\]`) to extract citation references from summary text.
 * Returns deduplicated citation keys in order of appearance.
 */
export function extractCitationKeysFromText(text: string): string[] {
	if (!text) return [];
	const matches = text.match(/\bart_\d+\b/g) || [];
	const uniqueKeys: string[] = [];
	const seen = new Set<string>();
	for (const key of matches) {
		if (!seen.has(key)) {
			seen.add(key);
			uniqueKeys.push(key);
		}
	}
	return uniqueKeys;
}

/**
 * Filters out any citation keys not in `validArticleMap` (e.g. `art_123`).
 * Deduplicates citation keys while maintaining order, returning valid keys and corresponding article IDs.
 */
export function validateAndRepairCitations(
	rawCitations: string[],
	validArticleMap: Map<string, number>,
): { validKeys: string[]; articleIds: number[] } {
	const validKeys: string[] = [];
	const articleIds: number[] = [];
	const seen = new Set<string>();

	if (!Array.isArray(rawCitations)) {
		return { validKeys, articleIds };
	}

	for (const raw of rawCitations) {
		if (typeof raw !== "string") continue;
		const keys = extractCitationKeysFromText(raw);
		for (const key of keys) {
			if (!seen.has(key) && validArticleMap.has(key)) {
				seen.add(key);
				validKeys.push(key);
				const articleId = validArticleMap.get(key);
				if (articleId !== undefined) {
					articleIds.push(articleId);
				}
			}
		}
	}

	return { validKeys, articleIds };
}

/**
 * Builds insert objects for Kysely `citation` table from citation keys and validArticleMap.
 */
export function buildCitationInserts(
	digestId: number,
	digestClusterId: number | null,
	validArticleMap: Map<string, number>,
	citationKeys: string[],
): Insertable<CitationTable>[] {
	const { validKeys, articleIds } = validateAndRepairCitations(
		citationKeys,
		validArticleMap,
	);

	return validKeys.map((key, index) => ({
		digest_id: digestId,
		digest_cluster_id: digestClusterId,
		article_id: articleIds[index],
		citation_key: key,
	}));
}
