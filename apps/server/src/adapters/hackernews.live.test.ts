import { describe, expect, test } from "bun:test";
import { HackerNewsAdapter } from "./hackernews";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Hacker News Adapter Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	test(
		"fetches live top stories from Firebase REST API",
		async () => {
			const adapter = new HackerNewsAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 101,
				type: "hackernews",
				name: "HN Top Live",
				url: null,
				config: JSON.stringify({ minScore: 10, limit: 5, maxAgeHours: 72 }),
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(items.length).toBeGreaterThan(0);
			expect(items[0].identityKey).toMatch(/^hn-\d+$/);
			expect(items[0].title).toBeTruthy();
			expect(items[0].url).toBeTruthy();
		},
		{ timeout: 15000 },
	);
});
