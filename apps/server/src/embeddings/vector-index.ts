import { cosineSimilarity } from "./types";

export interface VectorSearchResult {
	id: number;
	score: number;
}

export interface VectorIndex {
	add(id: number, vector: Float32Array): void;
	search(vector: Float32Array, topK?: number, minScore?: number): VectorSearchResult[];
	getAll(): Map<number, Float32Array>;
	clear(): void;
}

export class InMemoryVectorIndex implements VectorIndex {
	private vectors = new Map<number, Float32Array>();

	add(id: number, vector: Float32Array): void {
		this.vectors.set(id, vector);
	}

	search(query: Float32Array, topK = 10, minScore = 0.0): VectorSearchResult[] {
		const results: VectorSearchResult[] = [];
		for (const [id, vec] of this.vectors.entries()) {
			const score = cosineSimilarity(query, vec);
			if (score >= minScore) {
				results.push({ id, score });
			}
		}
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}

	getAll(): Map<number, Float32Array> {
		return this.vectors;
	}

	clear(): void {
		this.vectors.clear();
	}
}
