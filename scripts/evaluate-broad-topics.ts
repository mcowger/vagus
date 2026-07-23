import { Database } from "bun:sqlite";
import { createDb } from "../apps/server/src/db/connection";
import { generateCompletion } from "../apps/server/src/llm";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const MAX_LLM_ARTICLES = 12;

interface Article {
	id: number;
	title: string;
	stage_a_bullet: string | null;
}

interface TopicRule {
	name: string;
	matches(article: Article): boolean;
}

const TOPIC_RULES: TopicRule[] = [
	{
		name: "Iran war",
		matches: (article) => {
			const text = `${article.title}\n${article.stage_a_bullet ?? ""}`.toLowerCase();
			return text.includes("iran") && !/(jewelry|zendaya|odyssey)/.test(text);
		},
	},
	{
		name: "UK prime minister",
		matches: (article) => {
			const text = `${article.title}\n${article.stage_a_bullet ?? ""}`.toLowerCase().replaceAll("britain", "uk");
			return text.includes("prime minister") && (text.includes("uk") || text.includes("burnham"));
		},
	},
];

const source = new Database(DEV_DB_PATH, { readonly: true });
const articles = source.query("SELECT id, title, stage_a_bullet FROM article").all() as Article[];
source.close();

const db = createDb(DEV_DB_PATH);
try {
	for (const rule of TOPIC_RULES) {
		const bucket = articles.filter((article) => rule.matches(article));
		console.log(`[topic] ${rule.name}: ${bucket.length} articles`);
		console.log(JSON.stringify(bucket.map(({ id, title }) => ({ id, title })), null, 2));
		const prompt = `Do these articles belong in one reader-facing ongoing news topic, even when they cover different developments? Respond only with JSON: {"same_topic": true} or {"same_topic": false}.\n\nTopic: ${rule.name}\n\n${bucket.slice(0, MAX_LLM_ARTICLES).map((article) => `[art_${article.id}] ${article.title}\n${article.stage_a_bullet ?? ""}`).join("\n\n")}`;
		console.log(`[topic] Validating ${rule.name} with ${Math.min(bucket.length, MAX_LLM_ARTICLES)} representative articles...`);
		const result = await generateCompletion("event_identity_merge", prompt, {
			db: db.kysely,
			systemPrompt: "You are a news editor deciding whether coverage belongs in one reader-facing ongoing topic. Broad topic coverage may include policy, conflict, diplomacy, casualties, or economic consequences.",
		});
		console.log(JSON.stringify({ topic: rule.name, decision: result.text }));
	}
} finally {
	db.close();
}
