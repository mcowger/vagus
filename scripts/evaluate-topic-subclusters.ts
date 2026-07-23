import { Database } from "bun:sqlite";
import { cosineSimilarity, deserializeFloat32 } from "../apps/server/src/embeddings/types";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const SUBCLUSTER_THRESHOLD = 0.65;
const SPLIT_BUCKETS = ["ai", "house", "india", "meta", "ram", "arizona", "uk"];
const STOP_WORDS = new Set(["after", "america", "ap", "bbc", "china", "chinese", "cnn", "deal", "exclusive", "how", "latest", "live", "most", "new", "news", "red", "reuters", "the", "today", "us", "watch", "what", "when", "why", "with"]);

interface Article {
	id: number;
	title: string;
	stage_a_bullet: string | null;
	embedding: Uint8Array;
}

function terms(article: Pick<Article, "title" | "stage_a_bullet">): Set<string> {
	const namedTerms = article.title.match(/\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b/g) ?? [];
	const result = new Set(namedTerms.map((term) => term.toLowerCase()).filter((term) => !STOP_WORDS.has(term)));
	const normalized = `${article.title}\n${article.stage_a_bullet ?? ""}`.toLowerCase().replaceAll("britain", "uk");
	if (normalized.includes("prime minister") && (normalized.includes("uk") || normalized.includes("burnham"))) result.add("uk-prime-minister");
	return result;
}

function components(articles: Article[]): Article[][] {
	const parent = articles.map((_, index) => index);
	const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
	for (let left = 0; left < articles.length; left++) {
		for (let right = left + 1; right < articles.length; right++) {
			if (cosineSimilarity(deserializeFloat32(articles[left].embedding), deserializeFloat32(articles[right].embedding)) >= SUBCLUSTER_THRESHOLD) {
				const leftRoot = root(left);
				const rightRoot = root(right);
				if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
			}
		}
	}
	const groups = new Map<number, Article[]>();
	for (const [index, article] of articles.entries()) {
		const group = groups.get(root(index)) ?? [];
		group.push(article);
		groups.set(root(index), group);
	}
	return [...groups.values()].sort((left, right) => right.length - left.length);
}

const db = new Database(DEV_DB_PATH, { readonly: true });
const articles = db.query(`
	SELECT a.id, a.title, a.stage_a_bullet, ae.embedding
	FROM article a JOIN article_embedding ae ON ae.article_id = a.id
	WHERE a.publish_date >= datetime('now', '-48 hours') AND a.publish_date <= datetime('now', '+1 hour')
`).all() as Article[];
for (const bucket of SPLIT_BUCKETS) {
	const members = articles.filter((article) => terms(article).has(bucket));
	const groups = components(members);
	console.log(JSON.stringify({ bucket, members: members.length, components: groups.map((group) => group.map(({ id, title }) => ({ id, title }))) }, null, 2));
}
db.close();
