import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import { BraveNewsAdapter } from "./brave-news";
import { RssAdapter } from "./rss";

describe("Source Adapters", () => {
	test("RssAdapter parses RSS fixture correctly", async () => {
		const xmlFixture = readFileSync(
			join(__dirname, "fixtures/rss_feed.xml"),
			"utf-8",
		);

		// Intercept fetch call for rss feed url
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, init?: any) => {
			return new Response(xmlFixture, {
				status: 200,
				headers: { "Content-Type": "application/rss+xml" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new RssAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 1,
				type: "rss",
				name: "Tech News",
				url: "https://example.com/feed.xml",
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(items.length).toBe(2);
			expect(items[0].title).toBe("Bun 1.3 Released with Enhanced Capabilities");
			expect(items[0].identityKey).toBe("https://example.com/posts/bun-1-3-released");
			expect(items[1].title).toBe("TypeScript 5.8 Preview");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("BraveNewsAdapter parses Brave News json fixture correctly", async () => {
		const jsonFixture = readFileSync(
			join(__dirname, "fixtures/brave_news.json"),
			"utf-8",
		);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, init?: any) => {
			return new Response(jsonFixture, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new BraveNewsAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 2,
				type: "brave-news",
				name: "AI News",
				url: null,
				config: JSON.stringify({ query: "AI autonomous" }),
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource, { apiKey: "test-brave-key" });
			expect(items.length).toBe(2);
			expect(items[0].title).toBe("AI Breakthrough in Autonomous Agents");
			expect(items[0].identityKey).toBe("brave-news-1");
			expect(items[0].content).toContain("Researchers announce a major milestone");
			expect(items[1].title).toBe("Global Tech Summit 2026 Keynote Summary");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
