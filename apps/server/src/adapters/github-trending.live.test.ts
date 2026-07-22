import { describe, expect, test } from "bun:test";
import { GitHubTrendingAdapter } from "./github-trending";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live GitHub Trending Adapter Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	test(
		"fetches and parses live GitHub Trending page",
		async () => {
			const adapter = new GitHubTrendingAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 102,
				type: "github-trending",
				name: "GitHub Trending TypeScript",
				url: "https://github.com/trending/typescript",
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(items.length).toBeGreaterThan(0);
			expect(items[0].identityKey).toMatch(/^github-trending-.+$/);
			expect(items[0].title).toBeTruthy();
			expect(items[0].url).toContain("github.com");
		},
		{ timeout: 15000 },
	);
});
