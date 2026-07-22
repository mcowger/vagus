import { describe, expect, test } from "bun:test";
import { OpenAiEmbedder } from "./openai";
import { cosineSimilarity } from "./types";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live Embeddings Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	const baseUrl = process.env.TESTING_EMBEDDING_BASE_URL;
	const apiKey = process.env.TESTING_EMBEDDING_KEY;
	const modelName = process.env.TESTING_EMBEDDING_MODEL || "text-embedding-3-small";

	test("requires valid credentials in .env", () => {
		expect(baseUrl).toBeDefined();
		expect(baseUrl).not.toBe("https://samples.example.com/v1");
		expect(apiKey).toBeDefined();
		expect(apiKey).not.toBe("KEYGOESHERE");
	});

	const embedder = new OpenAiEmbedder({
		baseUrl,
		apiKey,
		modelName,
		throwOnFailure: true,
	});

	test("fetches single live embedding vector", async () => {
		expect(apiKey).toBeDefined();
		const vec = await embedder.embedText("Hello world from vagus live embedding test");
		expect(vec).toBeInstanceOf(Float32Array);
		expect(vec.length).toBeGreaterThan(0);
	});

	test("fetches batch live embeddings and measures semantic similarity", async () => {
		expect(apiKey).toBeDefined();
		const texts = [
			"software engineering and computer programming",
			"coding and software development",
			"baking delicious chocolate cake in an oven",
		];

		const vectors = await embedder.embedBatch(texts);
		expect(vectors.length).toBe(3);

		const simTech = cosineSimilarity(vectors[0], vectors[1]);
		const simUnrelated = cosineSimilarity(vectors[0], vectors[2]);

		expect(simTech).toBeGreaterThan(simUnrelated);
		expect(simTech).toBeGreaterThan(0.5);
	});
});
