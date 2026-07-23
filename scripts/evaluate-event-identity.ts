import { createDb } from "../apps/server/src/db/connection";
import { generateCompletion } from "../apps/server/src/llm";
import { getPromptTemplates, renderPrompt } from "../apps/server/src/prompts/defaults";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const PAIRS = [
	{ label: "Iran war cost", articleIds: [71, 500] },
	{ label: "UK PM policy", articleIds: [202, 505] },
];

const db = createDb(DEV_DB_PATH);
try {
	const { systemPrompt, userPromptTemplate } = await getPromptTemplates(db.kysely, "event_identity_merge");
	for (const pair of PAIRS) {
		const articles = await db.kysely.selectFrom("article").select(["id", "title", "stage_a_bullet"]).where("id", "in", pair.articleIds).execute();
		const clusters = articles.map((article) => `[art_${article.id}] ${article.title}\n${article.stage_a_bullet ?? ""}`);
		console.log(`[identity] Evaluating ${pair.label}...`);
		const completion = await generateCompletion("event_identity_merge", renderPrompt(userPromptTemplate, { leftCluster: clusters[0], rightCluster: clusters[1] }), { db: db.kysely, systemPrompt });
		console.log(JSON.stringify({ label: pair.label, articleIds: pair.articleIds, decision: completion.text }));
		if (pair.label === "UK PM policy") {
			console.log("[identity] Evaluating UK PM policy as a developing story...");
			const broadCompletion = await generateCompletion(
				"event_identity_merge",
				`Do these articles belong in one developing news story, even if they cover different policy details? Respond only with JSON: {"same_story": true} or {"same_story": false}.\n\nArticle A:\n${clusters[0]}\n\nArticle B:\n${clusters[1]}`,
				{ db: db.kysely, systemPrompt: "You are a news editor grouping related coverage into reader-friendly developing stories." },
			);
			console.log(JSON.stringify({ label: pair.label, decisionMode: "developing_story", decision: broadCompletion.text }));
		}
	}
} finally {
	db.close();
}
