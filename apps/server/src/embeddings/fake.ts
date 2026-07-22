import type { Embedder } from "./types";

export class FakeEmbedder implements Embedder {
	private dimensions: number;

	constructor(dimensions = 128) {
		this.dimensions = dimensions;
	}

	async embedText(text: string): Promise<Float32Array> {
		const vec = new Float32Array(this.dimensions);
		const lower = text.toLowerCase();
		
		for (let i = 0; i < lower.length; i++) {
			const charCode = lower.charCodeAt(i);
			const idx = (charCode * (i + 1)) % this.dimensions;
			vec[idx] += 1.0;
		}

		// Normalize vector
		let norm = 0;
		for (let i = 0; i < this.dimensions; i++) {
			norm += vec[i] * vec[i];
		}
		norm = Math.sqrt(norm);
		if (norm > 0) {
			for (let i = 0; i < this.dimensions; i++) {
				vec[i] /= norm;
			}
		}

		return vec;
	}

	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		return Promise.all(texts.map((t) => this.embedText(t)));
	}

	getDimensions(): number {
		return this.dimensions;
	}

	getModelName(): string {
		return "fake-embedder-128";
	}
}
