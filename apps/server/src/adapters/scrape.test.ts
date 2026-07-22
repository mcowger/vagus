import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import { ScrapeAdapter } from "./scrape";

describe("ScrapeAdapter", () => {
	test("parses HTML article fixture correctly", async () => {
		const htmlFixture = readFileSync(
			join(__dirname, "fixtures/scrape_article.html"),
			"utf-8",
		);

		const targetUrl = "https://example.com/articles/ai-architectures";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, init?: any) => {
			return new Response(htmlFixture, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new ScrapeAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 3,
				type: "scrape",
				name: "AI Blog Article",
				url: targetUrl,
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(items.length).toBe(1);

			const item = items[0];
			const expectedHash = createHash("sha256").update(targetUrl).digest("hex");
			expect(item.identityKey).toBe(`scrape-${expectedHash}`);
			expect(item.title).toBe("Understanding Modern AI Architectures");
			expect(item.url).toBe(targetUrl);
			expect(item.author).toBe("Alex Rivera");
			expect(item.publishDate).toBe("2026-03-15T10:00:00Z");
			expect(item.content).toContain("Autonomous agent architectures in particular enable complex multi-step reasoning");
			expect(item.imageUrl).toBe("https://example.com/images/ai-arch.jpg");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("throws error when source.url is missing", async () => {
		const adapter = new ScrapeAdapter();
		const fakeSource: Selectable<SourceTable> = {
			id: 4,
			type: "scrape",
			name: "No URL Source",
			url: null,
			config: null,
			enabled: 1,
			owner_user_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		await expect(adapter.fetchItems(fakeSource)).rejects.toThrow("missing URL");
	});
});
