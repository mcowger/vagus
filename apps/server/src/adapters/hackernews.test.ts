import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import { HackerNewsAdapter } from "./hackernews";

describe("HackerNewsAdapter", () => {
	const topstoriesFixture = readFileSync(
		join(__dirname, "fixtures/hackernews_topstories.json"),
		"utf-8",
	);

	const itemsFixture = JSON.parse(
		readFileSync(join(__dirname, "fixtures/hackernews_items.json"), "utf-8"),
	);

	function createFakeSource(config: string | null = null): Selectable<SourceTable> {
		return {
			id: 10,
			type: "hackernews",
			name: "Hacker News",
			url: null,
			config,
			enabled: 1,
			owner_user_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
	}

	test("fetches top stories and details applying default filtering (minScore: 50, limit: 15, maxAgeHours: 48)", async () => {
		const nowSec = Math.floor(Date.now() / 1000);
		const itemsMap: Record<string, any> = {
			...itemsFixture,
			"1001": { ...itemsFixture["1001"], time: nowSec - 3600 }, // 1 hr ago
			"1002": { ...itemsFixture["1002"], time: nowSec - 3600 }, // low score (20 < 50)
			"1003": { ...itemsFixture["1003"], time: nowSec - 100 * 3600 }, // old (100 hrs > 48 hrs)
			"1004": { ...itemsFixture["1004"], time: nowSec - 2 * 3600 }, // Ask HN (no url)
		};

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any) => {
			const urlStr = String(input);
			if (urlStr.includes("topstories.json")) {
				return new Response(topstoriesFixture, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			const match = urlStr.match(/\/item\/(\d+)\.json/);
			if (match) {
				const id = match[1];
				const item = itemsMap[id];
				if (item) {
					return new Response(JSON.stringify(item), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
			}

			return new Response("Not found", { status: 404 });
		}) as unknown as typeof fetch;

		try {
			const adapter = new HackerNewsAdapter();
			const items = await adapter.fetchItems(createFakeSource());

			expect(items.length).toBe(2);

			// Item 1001
			expect(items[0].identityKey).toBe("hn-1001");
			expect(items[0].title).toBe("Bun 1.3 Released");
			expect(items[0].url).toBe("https://bun.sh/blog/bun-v1.3");
			expect(items[0].author).toBe("jarred");
			expect(items[0].publishDate).toBe(new Date((nowSec - 3600) * 1000).toISOString());

			// Item 1004 (Ask HN fallback URL & content)
			expect(items[1].identityKey).toBe("hn-1004");
			expect(items[1].title).toBe("Ask HN: Favorite developer tools?");
			expect(items[1].url).toBe("https://news.ycombinator.com/item?id=1004");
			expect(items[1].author).toBe("curious_dev");
			expect(items[1].content).toBe("What tools do you use daily?");
			expect(items[1].publishDate).toBe(new Date((nowSec - 2 * 3600) * 1000).toISOString());
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("respects custom source.config settings", async () => {
		const nowSec = Math.floor(Date.now() / 1000);
		const itemsMap: Record<string, any> = {
			...itemsFixture,
			"1001": { ...itemsFixture["1001"], time: nowSec - 3600 },
			"1002": { ...itemsFixture["1002"], time: nowSec - 3600 }, // score 20
			"1003": { ...itemsFixture["1003"], time: nowSec - 100 * 3600 }, // 100 hrs old
			"1004": { ...itemsFixture["1004"], time: nowSec - 2 * 3600 },
		};

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any) => {
			const urlStr = String(input);
			if (urlStr.includes("topstories.json")) {
				return new Response(topstoriesFixture, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			const match = urlStr.match(/\/item\/(\d+)\.json/);
			if (match) {
				const id = match[1];
				const item = itemsMap[id];
				if (item) {
					return new Response(JSON.stringify(item), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
			}

			return new Response("Not found", { status: 404 });
		}) as unknown as typeof fetch;

		try {
			const adapter = new HackerNewsAdapter();
			// minScore: 10 allows item 1002 (score 20); maxAgeHours: 200 allows item 1003; limit: 1 returns only 1 item
			const source = createFakeSource(
				JSON.stringify({ minScore: 10, limit: 1, maxAgeHours: 200 }),
			);
			const items = await adapter.fetchItems(source);

			expect(items.length).toBe(1);
			expect(items[0].identityKey).toBe("hn-1001");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("handles empty topstories response gracefully", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new HackerNewsAdapter();
			const items = await adapter.fetchItems(createFakeSource());
			expect(items).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
