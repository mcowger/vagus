import { describe, expect, test } from "bun:test";
import { OpenAiEmbedder } from "./openai";
import { cosineSimilarity } from "./types";

const baseUrl = process.env.TESTING_EMBEDDING_BASE_URL;
const apiKey = process.env.TESTING_EMBEDDING_KEY;
const modelName = process.env.TESTING_EMBEDDING_MODEL || "text-embedding-3-small";

const hasLiveCredentials = Boolean(
	baseUrl &&
		apiKey &&
		apiKey !== "KEYGOESHERE" &&
		baseUrl !== "https://samples.example.com/v1",
);

describe("Live Embeddings Integration Test", () => {
	if (!hasLiveCredentials) {
		test.skip("Skipping live embedding test: credentials missing in .env", () => {});
		return;
	}

	const embedder = new OpenAiEmbedder({
		baseUrl,
		apiKey,
		modelName,
		throwOnFailure: true,
	});

	test("fetches single live embedding vector", async () => {
		const vec = await embedder.embedText("Hello world from vagus live embedding test");
		expect(vec).toBeInstanceOf(Float32Array);
		expect(vec.length).toBeGreaterThan(0);
	});

	test("fetches batch live embeddings and measures semantic similarity", async () => {
		const texts = [
			"software engineering and computer programming",
			"coding and software development",
			"baking delicious chocolate cake in an oven",
		];

		const vectors = await embedder.embedBatch(texts);
		expect(vectors.length).toBe(3);

		const simTech = cosineSimilarity(vectors[0], vectors[1]);
		const simUnrelated = cosineSimilarity(vectors[0], vectors[2]);

		// Semantic similarity between tech terms should be significantly higher than tech vs baking
		expect(simTech).toBeGreaterThan(simUnrelated);
		expect(simTech).toBeGreaterThan(0.5);
	});
});
