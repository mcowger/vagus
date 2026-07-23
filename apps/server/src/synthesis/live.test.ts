import { describe, expect, test } from "bun:test";
import { callLlmCompletion } from "../llm";
import { ClusterSummaryToolSchema, DigestToolSchema } from "./types";
import { parseClusterSummaryResponse } from "./synthesize-cluster";
import { parseDigestResult } from "./assemble-digest";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Synthesis & Digest Assembly Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	const baseUrl = process.env.TESTING_LLM_BASE_URL;
	const apiKey = process.env.TESTING_LLM_KEY;
	const modelName = process.env.TESTING_LLM_MODEL || "gpt-4o-mini";

	test("requires valid LLM credentials in .env", () => {
		expect(baseUrl).toBeDefined();
		expect(apiKey).toBeDefined();
		expect(apiKey).not.toBe("");
	});

	test(
		"executes live Stage B cluster synthesis structured completion",
		async () => {
			expect(apiKey).toBeDefined();

			const systemPrompt = `You are a news synthesis editor. Synthesize multi-document articles into a structured JSON summary matching this schema:
{
  "title": "Concise headline",
  "summary": "Multi-sentence overview",
  "perspectives": ["Key perspective or consensus"],
  "timeline": ["Chronological event"],
  "citations": ["art_1", "art_2"]
}`;

			const prompt = `Synthesize the following 2 articles into a cluster summary:

Article [art_1] (Space Telescope Discovers Atmosphere):
NASA's James Webb Space Telescope detected water vapor and carbon dioxide on distant exoplanet WASP-96b.

Article [art_2] (Hubble Confirms Exoplanet Observations):
Hubble astronomers confirmed atmospheric composition measurements of WASP-96b using complementary spectroscopy.`;

			const result = await callLlmCompletion({
				baseUrl,
				apiKey,
				modelName,
				systemPrompt,
				prompt,
				temperature: 0.2,
			});

			expect(result.text).toBeTruthy();
			const parsed = parseClusterSummaryResponse(result.text, new Set(["art_1", "art_2"]), "Default Title");
			expect(parsed.title).toBeTruthy();
			expect(parsed.summary).toBeTruthy();
			expect(Array.isArray(parsed.perspectives)).toBe(true);
			expect(Array.isArray(parsed.citations)).toBe(true);
		},
		{ timeout: 30000 },
	);

	test(
		"executes live Stage C digest assembly structured completion",
		async () => {
			expect(apiKey).toBeDefined();

			const systemPrompt = `You are an executive briefing editor. Assemble topic summaries into a structured executive digest JSON:
{
  "executive_summary": "High-level briefing",
  "key_takeaways": ["Takeaway 1", "Takeaway 2"],
  "why_it_matters": "Strategic significance",
  "key_quotes": [{"quote": "Direct quote", "citation": "art_1"}]
}`;

			const prompt = `Assemble an executive briefing digest from this topic cluster summary:

Topic Cluster: Space Telescope Breakthroughs
Summary: Space telescopes confirmed water vapor on exoplanet WASP-96b.
Perspectives: Multi-observatory consensus confirms high-precision atmospheric modeling.
Citations: art_1, art_2`;

			const result = await callLlmCompletion({
				baseUrl,
				apiKey,
				modelName,
				systemPrompt,
				prompt,
				temperature: 0.2,
			});

			expect(result.text).toBeTruthy();
			const parsed = parseDigestResult(result.text);
			expect(parsed.executive_summary).toBeTruthy();
			expect(parsed.why_it_matters).toBeTruthy();
			expect(Array.isArray(parsed.key_takeaways)).toBe(true);
		},
		{ timeout: 30000 },
	);
});
