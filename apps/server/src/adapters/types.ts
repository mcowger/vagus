import type { SourceTable } from "../db/schema";

export interface FetchedSourceItem {
	/** Unique identity key generated for deduplication (e.g., hash or url/guid). */
	identityKey: string;
	title: string;
	url: string;
	author?: string | null;
	content?: string | null;
	publishDate?: string | null;
	imageUrl?: string | null;
}

export interface SourceAdapter {
	/** Fetch raw items from a source given its DB configuration and optional API keys. */
	fetchItems(
		source: SourceTable,
		options?: { apiKey?: string; timeoutMs?: number },
	): Promise<FetchedSourceItem[]>;
}
