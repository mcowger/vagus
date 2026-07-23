import type { Kysely } from "kysely";
import type { Database } from "../db";
import { cosineSimilarity, deserializeFloat32 } from "./types";
import { getEmbedder } from "../queue/embed-job";

export const STANDARD_NEWS_TAXONOMY = [
	"Artificial Intelligence & Machine Learning",
	"Personal Finance, Banking & Investments",
	"Cybersecurity, Privacy & Hacking",
	"Smart Home, IoT & Gadget Hardware",
	"Legal Rulings, Legislation & Public Policy",
	"Software Engineering & Web Development",
	"Consumer Electronics & Mobile Devices",
	"Health, Biotech & Medical Science",
	"Climate Change, Clean Energy & Sustainability",
	"Macroeconomics, Markets & Inflation",
];

export interface TaxonomyProjectionResult {
	category: string;
	similarity: number; // 0.0 to 1.0
	matchPercentage: string; // e.g. "88%"
}

/** Cache for taxonomy vectors */
let cachedTaxonomyVectors: { category: string; vector: Float32Array }[] | null = null;
let cachedEmbedderModel: string | null = null;

export async function projectVectorToTaxonomy(
	db: Kysely<Database>,
	targetVector: Float32Array,
): Promise<TaxonomyProjectionResult[]> {
	if (!targetVector || targetVector.length === 0) return [];

	const embedder = await getEmbedder(db);
	const modelName = embedder.getModelName();

	// Recompute taxonomy vectors if embedder model changed or cache is empty
	if (!cachedTaxonomyVectors || cachedEmbedderModel !== modelName || cachedTaxonomyVectors[0]?.vector.length !== targetVector.length) {
		const newVectors: { category: string; vector: Float32Array }[] = [];
		for (const cat of STANDARD_NEWS_TAXONOMY) {
			try {
				const vec = await embedder.embedText(cat);
				newVectors.push({ category: cat, vector: vec });
			} catch {
				// Ignore individual embedding failures
			}
		}
		cachedTaxonomyVectors = newVectors;
		cachedEmbedderModel = modelName;
	}

	const results: TaxonomyProjectionResult[] = [];
	for (const item of cachedTaxonomyVectors) {
		if (item.vector.length === targetVector.length) {
			const sim = cosineSimilarity(targetVector, item.vector);
			if (sim >= 0.40) {
				results.push({
					category: item.category,
					similarity: sim,
					matchPercentage: `${Math.round(sim * 100)}%`,
				});
			}
		}
	}

	// Sort by highest similarity
	return results.sort((a, b) => b.similarity - a.similarity);
}
