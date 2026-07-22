import type { SourceTable } from "../db/schema";
import type { FetchedSourceItem, SourceAdapter } from "./types";

interface BraveNewsResult {
	id?: string;
	title: string;
	url: string;
	description?: string;
	published?: string;
	extra_snippets?: string[];
	thumbnail?: { src?: string };
}

interface BraveNewsResponse {
	results?: BraveNewsResult[];
}

export class BraveNewsAdapter implements SourceAdapter {
	async fetchItems(
		source: SourceTable,
		options?: { apiKey?: string; timeoutMs?: number },
	): Promise<FetchedSourceItem[]> {
		let apiKey = options?.apiKey;
		let query = "latest news";

		if (source.config) {
			try {
				const parsed = JSON.parse(source.config);
				if (parsed.query) query = parsed.query;
				if (!apiKey && parsed.apiKey) apiKey = parsed.apiKey;
			} catch {
				// use default config
			}
		}

		if (!apiKey) {
			throw new Error(`Brave News adapter requires an API key for source ${source.id}`);
		}

		const timeoutMs = options?.timeoutMs ?? 10000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		const searchUrl = new URL("https://api.search.brave.com/res/v1/news/search");
		searchUrl.searchParams.set("q", query);

		try {
			const res = await fetch(searchUrl.toString(), {
				headers: {
					"Accept": "application/json",
					"X-Subscription-Token": apiKey,
					"User-Agent": "Vagus/1.0 News Digest Bot (+https://vagus.local)",
				},
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(`Brave News API error: HTTP ${res.status}`);
			}

			const data = (await res.json()) as BraveNewsResponse;
			const results = data.results || [];
			const items: FetchedSourceItem[] = [];

			for (const item of results) {
				if (!item.url || !item.title) continue;

				const identityKey = item.id || item.url;
				const content = [item.description, ...(item.extra_snippets || [])]
					.filter(Boolean)
					.join(" ");

				items.push({
					identityKey,
					title: item.title.trim(),
					url: item.url,
					author: null,
					content: content || null,
					publishDate: item.published || null,
					imageUrl: item.thumbnail?.src || null,
				});
			}

			return items;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
