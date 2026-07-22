import { describe, expect, test } from "bun:test";
import { RssAdapter } from "./rss";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live RSS Adapter Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live RSS test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	const adapter = new RssAdapter();

	test(
		"fetches and parses a real public RSS feed",
		async () => {
			const feedUrl = "https://news.ycombinator.com/rss";
			const items = await adapter.fetchItems({
				id: 1,
				type: "rss",
				name: "Hacker News RSS",
				url: feedUrl,
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			});

			expect(items.length).toBeGreaterThan(0);
			expect(items[0].identityKey).toBeTruthy();
			expect(items[0].title).toBeTruthy();
			expect(items[0].url).toBeTruthy();
		},
		{ timeout: 15000 },
	);
});
