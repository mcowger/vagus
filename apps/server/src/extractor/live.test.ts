import { describe, expect, test } from "bun:test";
import { extractArticleFromUrl } from "./index";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Web Article Extraction Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live web extraction test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	test(
		"fetches live web page and extracts clean content via Readability",
		async () => {
			const targetUrl = "https://en.wikipedia.org/wiki/Artificial_intelligence";
			const article = await extractArticleFromUrl(targetUrl);

			expect(article.title).toBeTruthy();
			expect(article.content).toBeTruthy();
			expect(article.content!.length).toBeGreaterThan(100);
			expect(article.readingTimeMinutes).toBeGreaterThan(0);
		},
		{ timeout: 15000 },
	);
});
