import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import type { FetchedSourceItem, SourceAdapter } from "./types";

export interface HackerNewsConfig {
	minScore?: number;
	limit?: number;
	maxAgeHours?: number;
}

export interface HackerNewsItem {
	id: number;
	deleted?: boolean;
	type?: string;
	by?: string;
	time?: number;
	text?: string;
	dead?: boolean;
	parent?: number;
	poll?: number;
	kids?: number[];
	url?: string;
	score?: number;
	title?: string;
	parts?: number[];
	descendants?: number;
}

export class HackerNewsAdapter implements SourceAdapter {
	async fetchItems(
		source: Selectable<SourceTable>,
		options?: { timeoutMs?: number },
	): Promise<FetchedSourceItem[]> {
		let minScore = 50;
		let limit = 15;
		let maxAgeHours = 48;

		if (source.config) {
			try {
				const parsed = JSON.parse(source.config) as HackerNewsConfig;
				if (typeof parsed.minScore === "number") minScore = parsed.minScore;
				else if (typeof parsed.minScore === "string" && !isNaN(Number(parsed.minScore))) {
					minScore = Number(parsed.minScore);
				}

				if (typeof parsed.limit === "number") limit = parsed.limit;
				else if (typeof parsed.limit === "string" && !isNaN(Number(parsed.limit))) {
					limit = Number(parsed.limit);
				}

				if (typeof parsed.maxAgeHours === "number") maxAgeHours = parsed.maxAgeHours;
				else if (typeof parsed.maxAgeHours === "string" && !isNaN(Number(parsed.maxAgeHours))) {
					maxAgeHours = Number(parsed.maxAgeHours);
				}
			} catch {
				// use default config
			}
		}

		const timeoutMs = options?.timeoutMs ?? 10000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", {
				headers: {
					"Accept": "application/json",
					"User-Agent": "Vagus/1.0 News Digest Bot (+https://vagus.local)",
				},
				signal: controller.signal,
			});

			if (!topStoriesRes.ok) {
				throw new Error(`Hacker News topstories API error: HTTP ${topStoriesRes.status}`);
			}

			const storyIds = (await topStoriesRes.json()) as number[];
			if (!Array.isArray(storyIds) || storyIds.length === 0) {
				return [];
			}

			const nowMs = Date.now();
			const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
			const cutoffMs = nowMs - maxAgeMs;

			const items: FetchedSourceItem[] = [];
			const batchSize = Math.max(limit, 10);

			for (let i = 0; i < storyIds.length && items.length < limit; i += batchSize) {
				const batch = storyIds.slice(i, i + batchSize);
				const itemPromises = batch.map(async (id) => {
					try {
						const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
							headers: {
								"Accept": "application/json",
								"User-Agent": "Vagus/1.0 News Digest Bot (+https://vagus.local)",
							},
							signal: controller.signal,
						});

						if (!res.ok) return null;
						return (await res.json()) as HackerNewsItem;
					} catch {
						return null;
					}
				});

				const fetchedItems = await Promise.all(itemPromises);

				for (const item of fetchedItems) {
					if (!item || item.deleted || item.dead || !item.title) {
						continue;
					}

					// Filter by minScore
					const score = item.score ?? 0;
					if (score < minScore) {
						continue;
					}

					// Filter by maxAgeHours
					if (typeof item.time === "number") {
						const itemMs = item.time * 1000;
						if (itemMs < cutoffMs) {
							continue;
						}
					}

					const url = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
					const publishDate = item.time ? new Date(item.time * 1000).toISOString() : null;

					items.push({
						identityKey: `hn-${item.id}`,
						title: item.title.trim(),
						url,
						author: item.by ?? null,
						content: item.text ?? null,
						publishDate,
						imageUrl: null,
					});

					if (items.length >= limit) {
						break;
					}
				}
			}

			return items;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
