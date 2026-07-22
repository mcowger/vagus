import { describe, expect, test } from "bun:test";
import { callLlmCompletion } from "./index";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live LLM Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	const baseUrl = process.env.TESTING_LLM_BASE_URL;
	const apiKey = process.env.TESTING_LLM_KEY;
	const modelName = process.env.TESTING_LLM_MODEL || "gpt-4o-mini";

	test("requires valid credentials in .env", () => {
		expect(baseUrl).toBeDefined();
		expect(baseUrl).not.toBe("https://your-llm-endpoint.com/v1");
		expect(apiKey).toBeDefined();
		expect(apiKey).not.toBe("your-llm-api-key");
	});

	test(
		"executes simple completion prompt",
		async () => {
			expect(apiKey).toBeDefined();
			const result = await callLlmCompletion({
				baseUrl,
				apiKey,
				modelName,
				prompt: "What is 2 + 2? Answer with just the digit.",
				temperature: 0.0,
				throwOnFailure: true,
			});

			expect(result.text).toBeTruthy();
			expect(result.text).toContain("4");
			expect(result.usage.promptTokens).toBeGreaterThan(0);
			expect(result.usage.completionTokens).toBeGreaterThan(0);
		},
		{ timeout: 30000 },
	);

	test(
		"generates single-sentence article bullet summary",
		async () => {
			expect(apiKey).toBeDefined();
			const articleExcerpt = `
				NASA's James Webb Space Telescope has captured a stunning new high-resolution image
				of a cosmic ring galaxy located 500 million light-years away in the constellation Sculptor.
				The image reveals intricate details of star formation and interstellar dust clouds
				that were previously obscured from astronomers.
			`;

			const result = await callLlmCompletion({
				baseUrl,
				apiKey,
				modelName,
				systemPrompt:
					"You are a news digest generator. Summarize the key event into a single concise sentence.",
				prompt: `Summarize this news article excerpt into 1 sentence:\n${articleExcerpt}`,
				temperature: 0.2,
				throwOnFailure: true,
			});

			expect(result.text).toBeTruthy();
			expect(result.text.length).toBeGreaterThan(15);
			expect(result.usage.promptTokens).toBeGreaterThan(10);
		},
		{ timeout: 30000 },
	);

	test(
		"handles structured text classification prompt",
		async () => {
			expect(apiKey).toBeDefined();
			const prompt = `Classify the primary category of this headline: "Fed cuts interest rates by 25 basis points amid cooling inflation". Respond in JSON format with keys 'category' and 'confidence'.`;

			const result = await callLlmCompletion({
				baseUrl,
				apiKey,
				modelName,
				prompt,
				temperature: 0.1,
				throwOnFailure: true,
			});

			expect(result.text).toBeTruthy();
			const jsonMatch = result.text.match(/\{[\s\S]*\}/);
			expect(jsonMatch).not.toBeNull();

			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				expect(parsed).toHaveProperty("category");
				expect(typeof parsed.category).toBe("string");
			}
		},
		{ timeout: 30000 },
	);
});
