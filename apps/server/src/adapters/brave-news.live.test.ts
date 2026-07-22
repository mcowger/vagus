import { describe, expect, test } from "bun:test";
import { BraveNewsAdapter } from "./brave-news";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Brave News Adapter Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	const braveApiKey = process.env.TESTING_BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;

	test(
		"requires valid TESTING_BRAVE_API_KEY and executes search query",
		async () => {
			expect(braveApiKey).toBeDefined();
			expect(braveApiKey).not.toBe("");
			expect(braveApiKey).not.toBe("your-brave-key");

			const adapter = new BraveNewsAdapter();
			const items = await adapter.fetchItems(
				{
					id: 2,
					type: "brave-news",
					name: "Brave AI News",
					url: null,
					config: JSON.stringify({ query: "artificial intelligence" }),
					enabled: 1,
					owner_user_id: null,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
				{ apiKey: braveApiKey },
			);

			expect(items.length).toBeGreaterThan(0);
			expect(items[0].identityKey).toBeTruthy();
			expect(items[0].title).toBeTruthy();
			expect(items[0].url).toBeTruthy();
		},
		{ timeout: 15000 },
	);
});
