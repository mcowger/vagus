import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import { GitHubTrendingAdapter } from "./github-trending";

describe("GitHubTrendingAdapter", () => {
	const htmlFixture = readFileSync(
		join(__dirname, "fixtures/github_trending.html"),
		"utf-8",
	);

	test("parses HTML fixture correctly", () => {
		const adapter = new GitHubTrendingAdapter();
		const items = adapter.parseHtml(htmlFixture);

		expect(items.length).toBe(2);

		expect(items[0]).toEqual({
			identityKey: "github-trending-torvalds-linux",
			title: "torvalds/linux",
			url: "https://github.com/torvalds/linux",
			author: "torvalds",
			content: "Linux kernel source tree",
		});

		expect(items[1]).toEqual({
			identityKey: "github-trending-oven-sh-bun",
			title: "oven-sh/bun",
			url: "https://github.com/oven-sh/bun",
			author: "oven-sh",
			content: "Incredibly fast JavaScript frontend & backend runtime",
		});
	});

	test("fetchItems fetches from default URL when source.url and config are absent", async () => {
		let requestedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any) => {
			requestedUrl = typeof input === "string" ? input : input.url;
			return new Response(htmlFixture, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new GitHubTrendingAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 1,
				type: "github-trending",
				name: "GitHub Trending",
				url: null,
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(requestedUrl).toBe("https://github.com/trending");
			expect(items.length).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchItems fetches language specific URL when config.language is provided", async () => {
		let requestedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any) => {
			requestedUrl = typeof input === "string" ? input : input.url;
			return new Response(htmlFixture, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new GitHubTrendingAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 2,
				type: "github-trending",
				name: "GitHub Trending TypeScript",
				url: null,
				config: JSON.stringify({ language: "typescript" }),
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(requestedUrl).toBe("https://github.com/trending/typescript");
			expect(items.length).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchItems prefers source.url when explicitly provided", async () => {
		let requestedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any) => {
			requestedUrl = typeof input === "string" ? input : input.url;
			return new Response(htmlFixture, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}) as unknown as typeof fetch;

		try {
			const adapter = new GitHubTrendingAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 3,
				type: "github-trending",
				name: "GitHub Trending Rust",
				url: "https://github.com/trending/rust",
				config: JSON.stringify({ language: "typescript" }),
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(requestedUrl).toBe("https://github.com/trending/rust");
			expect(items.length).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
