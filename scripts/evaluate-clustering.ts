import { clusterRunArticles } from "../apps/server/src/clustering";
import { createDb } from "../apps/server/src/db/connection";
import { migrateToLatest } from "../apps/server/src/db/migrate";
import { getArticleEligibilitySettings, isEligibleArticle } from "../apps/server/src/pipeline/article-eligibility";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const ENABLE_LLM_MERGE = process.env.VAGUS_EVALUATION_LLM_MERGE === "true";

const db = createDb(DEV_DB_PATH);
try {
	console.log("[evaluation] Applying migrations...");
	await migrateToLatest(db.kysely);
	const settings = await getArticleEligibilitySettings(db.kysely);
	const articles = await db.kysely.selectFrom("article").selectAll().execute();
	const eligibleArticles = articles.filter((article) => isEligibleArticle(article, settings));
	console.log(`[evaluation] Eligibility: ${eligibleArticles.length}/${articles.length} articles within ${settings.maxAgeHours} hours and not feed artifacts.`);

	const run = await db.kysely
		.insertInto("run")
		.values({ trigger: "manual", status: "running", started_at: new Date().toISOString(), finished_at: null })
		.returning("id")
		.executeTakeFirstOrThrow();
	await db.kysely.updateTable("article").set({ run_id: null }).execute();
	await db.kysely.updateTable("article").set({ run_id: run.id }).where("id", "in", eligibleArticles.map((article) => article.id)).execute();

	const allSettings = new Map((await db.kysely.selectFrom("system_setting").select(["key", "value"]).execute()).map((row) => [row.key, row.value]));
	console.log(`[evaluation] Clustering run ${run.id}${ENABLE_LLM_MERGE ? " with bounded LLM event merging" : " without LLM event merging"}...`);
	const result = await clusterRunArticles(db.kysely, run.id, {
		threshold: Number(allSettings.get("clustering_similarity_threshold") ?? 0.8),
		llmMergeEnabled: ENABLE_LLM_MERGE,
		topicSubclusterThreshold: Number(allSettings.get("clustering_topic_subcluster_threshold") ?? 0.65),
		topicValidationMaxBuckets: Number(allSettings.get("clustering_topic_validation_max_buckets") ?? 20),
	});
	const distribution = await db.kysely
		.selectFrom("cluster as c")
		.innerJoin("cluster_article as ca", "ca.cluster_id", "c.id")
		.select((expression) => [expression.fn.count<number>("c.id").as("clusters"), expression.fn.count<number>("ca.article_id").as("articles")])
		.where("c.run_id", "=", run.id)
		.executeTakeFirstOrThrow();
	await db.kysely.updateTable("run").set({ status: "complete", finished_at: new Date().toISOString() }).where("id", "=", run.id).execute();
	console.log(`[evaluation] Complete: ${result.clusters.length} clusters covering ${distribution.articles} eligible articles.`);
} finally {
	db.close();
}
