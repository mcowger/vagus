import { FakeEmbedder } from "./fake";
import type { Embedder } from "./types";
import { log } from "../log";

export interface OpenAiEmbedderOptions {
	apiKey?: string;
	modelName?: string;
	dimensions?: number;
	baseUrl?: string;
	throwOnFailure?: boolean;
}

export class OpenAiEmbedder implements Embedder {
	private apiKey?: string;
	private modelName: string;
	private dimensions: number;
	private baseUrl: string;
	private throwOnFailure: boolean;
	private fallback: FakeEmbedder;

	constructor(
		apiKeyOrOptions?: string | OpenAiEmbedderOptions,
		modelName?: string,
		dimensions?: number,
		baseUrl?: string,
	) {
		if (typeof apiKeyOrOptions === "object" && apiKeyOrOptions !== null) {
			this.apiKey = apiKeyOrOptions.apiKey ?? process.env.OPENAI_API_KEY;
			this.modelName = apiKeyOrOptions.modelName ?? "text-embedding-3-small";
			this.dimensions = apiKeyOrOptions.dimensions ?? 1536;
			this.baseUrl = apiKeyOrOptions.baseUrl ?? "https://api.openai.com/v1";
			this.throwOnFailure = apiKeyOrOptions.throwOnFailure ?? false;
		} else {
			this.apiKey = apiKeyOrOptions ?? process.env.OPENAI_API_KEY;
			this.modelName = modelName ?? "text-embedding-3-small";
			this.dimensions = dimensions ?? 1536;
			this.baseUrl = baseUrl ?? "https://api.openai.com/v1";
			this.throwOnFailure = false;
		}
		this.fallback = new FakeEmbedder(this.dimensions);
	}

	getDimensions(): number {
		return this.dimensions;
	}

	getModelName(): string {
		return this.modelName;
	}

	private getEndpoint(): string {
		const base = this.baseUrl.replace(/\/+$/, "");
		return base.endsWith("/embeddings") ? base : `${base}/embeddings`;
	}

	async embedText(text: string): Promise<Float32Array> {
		if (!this.apiKey) {
			return this.fallback.embedText(text);
		}

		try {
			const res = await fetch(this.getEndpoint(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.modelName,
					input: text,
				}),
			});

			if (!res.ok) {
				throw new Error(`OpenAI API status ${res.status}: ${res.statusText}`);
			}

			const data = (await res.json()) as any;
			const vecArray = data?.data?.[0]?.embedding;
			if (!Array.isArray(vecArray)) {
				throw new Error("Invalid response structure from OpenAI embeddings API");
			}

			return new Float32Array(vecArray);
		} catch (err) {
			if (this.throwOnFailure) {
				throw err;
			}
			log.warn("OpenAiEmbedder call failed, falling back to FakeEmbedder", {
				error: String(err),
				model: this.modelName,
			});
			return this.fallback.embedText(text);
		}
	}

	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		if (texts.length === 0) {
			return [];
		}

		if (!this.apiKey) {
			if (this.throwOnFailure) {
				throw new Error("Missing API key for OpenAiEmbedder");
			}
			return this.fallback.embedBatch(texts);
		}

		try {
			const res = await fetch(this.getEndpoint(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.modelName,
					input: texts,
				}),
			});

			if (!res.ok) {
				throw new Error(`OpenAI API status ${res.status}: ${res.statusText}`);
			}

			const data = (await res.json()) as any;
			if (!Array.isArray(data?.data)) {
				throw new Error("Invalid response structure from OpenAI embeddings API");
			}

			const items = data.data.slice().sort((a: any, b: any) => a.index - b.index);
			return items.map((item: any) => new Float32Array(item.embedding));
		} catch (err) {
			if (this.throwOnFailure) {
				throw err;
			}
			log.warn("OpenAiEmbedder batch call failed, falling back to FakeEmbedder", {
				error: String(err),
				model: this.modelName,
			});
			return this.fallback.embedBatch(texts);
		}
	}
}
