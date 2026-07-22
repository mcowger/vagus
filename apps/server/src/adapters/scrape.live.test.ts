import { describe, expect, test } from "bun:test";
import { ScrapeAdapter } from "./scrape";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Generic Scrape Adapter Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	test(
		"fetches and extracts main article content from live public URL",
		async () => {
			const adapter = new ScrapeAdapter();
			const fakeSource: Selectable<SourceTable> = {
				id: 103,
				type: "scrape",
				name: "Example Scrape Target",
				url: "https://example.com",
				config: null,
				enabled: 1,
				owner_user_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};

			const items = await adapter.fetchItems(fakeSource);
			expect(items.length).toBe(1);
			expect(items[0].identityKey).toMatch(/^scrape-[a-f0-9]{64}$/);
			expect(items[0].title).toBeTruthy();
			expect(items[0].content).toBeTruthy();
		},
		{ timeout: 15000 },
	);
});
