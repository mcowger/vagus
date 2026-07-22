import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { DOMParser } from "linkedom";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import type { FetchedSourceItem, SourceAdapter } from "./types";

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export class ScrapeAdapter implements SourceAdapter {
	async fetchItems(
		source: Selectable<SourceTable>,
		options?: { timeoutMs?: number },
	): Promise<FetchedSourceItem[]> {
		if (!source.url) {
			throw new Error(`Scrape source ${source.id} (${source.name}) missing URL`);
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
				throw new Error(`Failed to fetch webpage from ${source.url}: HTTP ${res.status}`);
			}

			const html = await res.text();
			const doc = new DOMParser().parseFromString(html, "text/html");
			const reader = new Readability(doc as unknown as Document);
			const article = reader.parse();

			const identityKey = `scrape-${sha256(source.url)}`;

			const title =
				article?.title?.trim() ||
				doc.querySelector("title")?.textContent?.trim() ||
				"Untitled";

			const content =
				article?.textContent?.trim() ||
				article?.content ||
				null;

			const author =
				article?.byline?.trim() ||
				doc.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() ||
				doc.querySelector('meta[property="article:author"]')?.getAttribute("content")?.trim() ||
				null;

			const publishDate =
				article?.publishedTime?.trim() ||
				doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content")?.trim() ||
				doc.querySelector('meta[name="date"]')?.getAttribute("content")?.trim() ||
				doc.querySelector("time")?.getAttribute("datetime")?.trim() ||
				null;

			const imageUrl =
				doc.querySelector('meta[property="og:image"]')?.getAttribute("content")?.trim() ||
				doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content")?.trim() ||
				null;

			return [
				{
					identityKey,
					title,
					url: source.url,
					author,
					content,
					publishDate,
					imageUrl,
				},
			];
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
