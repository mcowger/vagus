import Parser from "rss-parser";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import type { FetchedSourceItem, SourceAdapter } from "./types";

export class RssAdapter implements SourceAdapter {
	private parser = new Parser();

	async fetchItems(
		source: Selectable<SourceTable>,
		options?: { timeoutMs?: number },
	): Promise<FetchedSourceItem[]> {
		if (!source.url) {
			throw new Error(`RSS source ${source.id} (${source.name}) missing URL`);
		}

		const timeoutMs = options?.timeoutMs ?? 10000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(source.url, {
				headers: {
					"User-Agent": "Vagus/1.0 News Digest Bot (+https://vagus.local)",
				},
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(`Failed to fetch RSS from ${source.url}: HTTP ${res.status}`);
			}

			const xmlText = await res.text();
			const feed = await this.parser.parseString(xmlText);

			const items: FetchedSourceItem[] = [];

			for (const item of feed.items) {
				const url = item.link || item.guid;
				if (!url) continue;

				// Stable identity key: link/guid, or fallback hash
				const identityKey = item.guid || url;

				items.push({
					identityKey,
					title: item.title?.trim() || "Untitled",
					url,
					author: item.creator || item.author || null,
					content: item.contentSnippet || item.content || item.summary || null,
					publishDate: item.isoDate || item.pubDate || null,
					imageUrl: item.enclosure?.url || null,
				});
			}

			return items;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
