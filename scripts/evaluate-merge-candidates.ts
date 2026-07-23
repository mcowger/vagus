import { Database } from "bun:sqlite";
import { cosineSimilarity, deserializeFloat32 } from "../apps/server/src/embeddings/types";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const RUN_ID = Number(process.env.VAGUS_EVALUATION_RUN_ID ?? 8);
const MIN_SIMILARITY = 0.45;
const MAX_SIMILARITY = 0.8;
const STOP_WORDS = new Set(["about", "after", "amid", "and", "are", "as", "at", "by", "for", "from", "has", "in", "is", "its", "new", "of", "on", "or", "the", "to", "with"]);

function meaningfulTokens(title: string): Set<string> {
	return new Set(title.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) ?? []);
}

const db = new Database(DEV_DB_PATH, { readonly: true });
const rows = db.query(`
	SELECT c.id AS cluster_id, c.primary_article_id, a.title, ae.embedding
	FROM cluster c
	JOIN article a ON a.id = c.primary_article_id
	JOIN article_embedding ae ON ae.article_id = a.id
	WHERE c.run_id = ?
`).all(RUN_ID) as Array<{ cluster_id: number; primary_article_id: number; title: string; embedding: Uint8Array }>;
const documentFrequency = new Map<string, number>();
for (const row of rows) {
	for (const token of meaningfulTokens(row.title)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
}

const candidates = rows.flatMap((left, index) => rows.slice(index + 1).map((right) => {
	const similarity = cosineSimilarity(deserializeFloat32(left.embedding), deserializeFloat32(right.embedding));
	const sharedTerms = [...meaningfulTokens(left.title)].filter((token) => meaningfulTokens(right.title).has(token));
	const entityWeight = sharedTerms.reduce((total, token) => total + Math.log(rows.length / (documentFrequency.get(token) ?? rows.length)), 0);
	return {
		leftClusterId: left.cluster_id,
		rightClusterId: right.cluster_id,
		similarity,
		sharedTerms,
		priority: similarity + Math.min(entityWeight, 8) * 0.1,
		entityWeight,
		leftTitle: left.title,
		rightTitle: right.title,
	};
})).filter((candidate) => candidate.similarity >= MIN_SIMILARITY && candidate.similarity < MAX_SIMILARITY && candidate.sharedTerms.length > 0);

const rankedCandidates = candidates.sort((left, right) => right.priority - left.priority);
const articleClusters = db.query(`SELECT ca.article_id, ca.cluster_id FROM cluster_article ca JOIN cluster c ON c.id = ca.cluster_id WHERE c.run_id = ?`).all(RUN_ID) as Array<{ article_id: number; cluster_id: number }>;
const clusterForArticle = new Map(articleClusters.map((row) => [row.article_id, row.cluster_id]));
const targetPairs = [
	{ label: "Iran war cost", leftArticleId: 71, rightArticleId: 500 },
	{ label: "UK PM policy", leftArticleId: 202, rightArticleId: 505 },
].map((target) => {
	const leftClusterId = clusterForArticle.get(target.leftArticleId);
	const rightClusterId = clusterForArticle.get(target.rightArticleId);
	const candidate = rankedCandidates.find((item) =>
		(item.leftClusterId === leftClusterId && item.rightClusterId === rightClusterId) ||
		(item.leftClusterId === rightClusterId && item.rightClusterId === leftClusterId),
	);
	return { ...target, leftClusterId, rightClusterId, rank: candidate ? rankedCandidates.indexOf(candidate) + 1 : null, candidate };
});

console.log(JSON.stringify({ runId: RUN_ID, candidateCount: rankedCandidates.length, targets: targetPairs, candidates: rankedCandidates.slice(0, 30) }, null, 2));
