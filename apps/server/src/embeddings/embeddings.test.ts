import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeEmbedder } from "./fake";
import { OpenAiEmbedder } from "./openai";
import { cosineSimilarity, deserializeFloat32, serializeFloat32 } from "./types";

describe("Embeddings Module", () => {
	describe("FakeEmbedder", () => {
		test("generates vectors with specified dimensions", async () => {
			const embedder = new FakeEmbedder(64);
			expect(embedder.getDimensions()).toBe(64);
			expect(embedder.getModelName()).toBe("fake-embedder-128");

			const vec = await embedder.embedText("Hello World");
			expect(vec).toBeInstanceOf(Float32Array);
			expect(vec.length).toBe(64);
		});

		test("embedBatch processes multiple texts", async () => {
			const embedder = new FakeEmbedder(32);
			const vecs = await embedder.embedBatch(["First text", "Second text"]);
			expect(vecs.length).toBe(2);
			expect(vecs[0].length).toBe(32);
			expect(vecs[1].length).toBe(32);
		});
	});

	describe("OpenAiEmbedder", () => {
		const origFetch = globalThis.fetch;
		const origApiKey = process.env.OPENAI_API_KEY;

		beforeEach(() => {
			delete process.env.OPENAI_API_KEY;
		});

		afterEach(() => {
			globalThis.fetch = origFetch;
			if (origApiKey) {
				process.env.OPENAI_API_KEY = origApiKey;
			} else {
				delete process.env.OPENAI_API_KEY;
			}
		});

		test("falls back to FakeEmbedder when no API key is provided", async () => {
			const embedder = new OpenAiEmbedder();
			expect(embedder.getDimensions()).toBe(1536);
			expect(embedder.getModelName()).toBe("text-embedding-3-small");

			const vec = await embedder.embedText("Fallback test text");
			expect(vec).toBeInstanceOf(Float32Array);
			expect(vec.length).toBe(1536);
		});

		test("calls OpenAI /v1/embeddings when API key is provided", async () => {
			const fakeEmbedding = new Array(1536).fill(0.1);
			globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
				expect(String(url)).toContain("/v1/embeddings");
				expect(init?.headers).toMatchObject({
					Authorization: "Bearer test-api-key",
				});
				return new Response(
					JSON.stringify({
						data: [{ embedding: fakeEmbedding, index: 0 }],
					}),
					{ status: 200 },
				);
			}) as any;

			const embedder = new OpenAiEmbedder({ apiKey: "test-api-key" });
			const vec = await embedder.embedText("OpenAI test");
			expect(vec.length).toBe(1536);
			expect(vec[0]).toBeCloseTo(0.1);
		});

		test("handles embedBatch with OpenAI API", async () => {
			const fakeEmbedding1 = new Array(1536).fill(0.2);
			const fakeEmbedding2 = new Array(1536).fill(0.3);

			globalThis.fetch = (async () => {
				return new Response(
					JSON.stringify({
						data: [
							{ embedding: fakeEmbedding2, index: 1 },
							{ embedding: fakeEmbedding1, index: 0 },
						],
					}),
					{ status: 200 },
				);
			}) as any;

			const embedder = new OpenAiEmbedder("test-api-key");
			const vecs = await embedder.embedBatch(["Text 1", "Text 2"]);
			expect(vecs.length).toBe(2);
			expect(vecs[0][0]).toBeCloseTo(0.2);
			expect(vecs[1][0]).toBeCloseTo(0.3);
		});

		test("gracefully falls back to FakeEmbedder when API fetch fails", async () => {
			globalThis.fetch = (async () => {
				return new Response("Internal Server Error", { status: 500 });
			}) as any;

			const embedder = new OpenAiEmbedder({ apiKey: "test-key" });
			const vec = await embedder.embedText("Error fallback test");
			expect(vec).toBeInstanceOf(Float32Array);
			expect(vec.length).toBe(1536);
		});

		test("handles network exception by falling back to FakeEmbedder", async () => {
			globalThis.fetch = (async () => {
				throw new Error("Network connection reset");
			}) as any;

			const embedder = new OpenAiEmbedder({ apiKey: "test-key" });
			const vecs = await embedder.embedBatch(["Network failure text"]);
			expect(vecs.length).toBe(1);
			expect(vecs[0]).toBeInstanceOf(Float32Array);
			expect(vecs[0].length).toBe(1536);
		});
	});

	describe("Vector Utilities", () => {
		test("serializeFloat32 and deserializeFloat32 roundtrip", () => {
			const original = new Float32Array([0.1, -0.5, 3.14159, 100.0]);
			const serialized = serializeFloat32(original);
			expect(serialized).toBeInstanceOf(Uint8Array);

			const deserialized = deserializeFloat32(serialized);
			expect(deserialized).toBeInstanceOf(Float32Array);
			expect(deserialized.length).toBe(original.length);
			for (let i = 0; i < original.length; i++) {
				expect(deserialized[i]).toBeCloseTo(original[i]);
			}
		});

		test("cosineSimilarity returns expected similarity", () => {
			const a = new Float32Array([1, 0, 0]);
			const b = new Float32Array([1, 0, 0]);
			const c = new Float32Array([0, 1, 0]);

			expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
			expect(cosineSimilarity(a, c)).toBeCloseTo(0.0);
		});
	});
});
