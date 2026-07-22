import { describe, expect, test } from "bun:test";
import { BraveNewsAdapter } from "./brave-news";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";
const braveApiKey = process.env.TESTING_BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;

const hasBraveCredentials = Boolean(
	isLiveRequested && braveApiKey && braveApiKey !== "your-brave-key",
);

describe("Live Brave News Adapter Integration Test", () => {
	if (!hasBraveCredentials) {
		test.skip("Skipping live Brave News test: RUN_LIVE_TESTS=1 not set or TESTING_BRAVE_API_KEY missing", () => {});
		return;
	}

	const adapter = new BraveNewsAdapter();

	test(
		"executes real search query against Brave News API",
		async () => {
			const items = await adapter.fetchItems(
				{
					id: 2,
					type: "brave-news",
					name: "Brave Artificial Intelligence News",
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
