import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { getArticleEligibilitySettings, isEligibleArticle } from "../apps/server/src/pipeline/article-eligibility";
import { createDb } from "../apps/server/src/db/connection";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const OUTPUT_PATH = process.env.VAGUS_REVIEW_OUTPUT ?? "./docs/reviews/topic-bucket-review.md";
const REVIEW_BUCKET_COUNT = 20;
const MAX_ARTICLES_PER_BUCKET = 12;
const MIN_TERM_FREQUENCY = 3;
const MAX_BUCKET_OVERLAP = 0.6;
const STOP_WORDS = new Set(["after", "america", "ap", "bbc", "china", "chinese", "cnn", "deal", "exclusive", "how", "latest", "live", "most", "new", "news", "red", "reuters", "the", "today", "us", "watch", "what", "when", "why", "with"]);

interface Article {
	id: number;
	title: string;
	stage_a_bullet: string | null;
	content: string | null;
	publish_date: string | null;
}

function terms(article: Article): Set<string> {
	const namedTerms = article.title.match(/\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b/g) ?? [];
	const result = new Set(namedTerms.map((term) => term.toLowerCase()).filter((term) => !STOP_WORDS.has(term)));
	const normalized = `${article.title}\n${article.stage_a_bullet ?? ""}`.toLowerCase().replaceAll("britain", "uk");
	if (normalized.includes("prime minister") && (normalized.includes("uk") || normalized.includes("burnham"))) result.add("uk-prime-minister");
	if (normalized.includes("iran") && !/(jewelry|zendaya|odyssey)/.test(normalized)) result.add("iran-war");
	return result;
}

function overlap(left: Set<number>, right: Set<number>): number {
	let intersection = 0;
	for (const id of left) if (right.has(id)) intersection++;
	return intersection / Math.min(left.size, right.size);
}

const raw = new Database(DEV_DB_PATH, { readonly: true });
const db = createDb(DEV_DB_PATH);
try {
	const settings = await getArticleEligibilitySettings(db.kysely);
	const articles = (raw.query("SELECT id, title, stage_a_bullet, content, publish_date FROM article").all() as Article[])
		.filter((article) => isEligibleArticle(article, settings));
	const articleTerms = new Map(articles.map((article) => [article.id, terms(article)]));
	const termArticles = new Map<string, Set<number>>();
	for (const article of articles) {
		for (const term of articleTerms.get(article.id) ?? []) {
			const ids = termArticles.get(term) ?? new Set<number>();
			ids.add(article.id);
			termArticles.set(term, ids);
		}
	}

	const selected: Array<{ term: string; articleIds: Set<number> }> = [];
	for (const [term, articleIds] of [...termArticles.entries()].sort((left, right) => right[1].size - left[1].size)) {
		if (articleIds.size < MIN_TERM_FREQUENCY) continue;
		if (selected.some((bucket) => overlap(bucket.articleIds, articleIds) > MAX_BUCKET_OVERLAP)) continue;
		selected.push({ term, articleIds });
		if (selected.length === REVIEW_BUCKET_COUNT) break;
	}

	const byId = new Map(articles.map((article) => [article.id, article]));
	const lines = [
		"# Broad Topic Bucket Review",
		"",
		`Eligible corpus: ${articles.length} articles. Generated: ${new Date().toISOString()}.`,
		"",
		"For each proposed reader-facing topic, mark exactly one: **Keep**, **Split**, or **Exclude**. Add a short note for splits or exclusions.",
		"",
	];
	for (const [index, bucket] of selected.entries()) {
		const members = [...bucket.articleIds].map((id) => byId.get(id)!).sort((left, right) => left.id - right.id);
		lines.push(`## ${index + 1}. ${bucket.term} (${members.length} articles)`, "", "- [ ] Keep", "- [ ] Split", "- [ ] Exclude", "- Notes: ", "");
		for (const article of members.slice(0, MAX_ARTICLES_PER_BUCKET)) lines.push(`- [art_${article.id}] ${article.title}`);
		if (members.length > MAX_ARTICLES_PER_BUCKET) lines.push(`- … ${members.length - MAX_ARTICLES_PER_BUCKET} additional articles`);
		lines.push("");
	}

	await mkdir(dirname(OUTPUT_PATH), { recursive: true });
	await Bun.write(OUTPUT_PATH, `${lines.join("\n")}\n`);
	console.log(`[review] Wrote ${selected.length} topic buckets from ${articles.length} eligible articles to ${OUTPUT_PATH}`);
} finally {
	raw.close();
	db.close();
}
