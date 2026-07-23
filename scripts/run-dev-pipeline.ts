import { clusterRunArticles } from "../apps/server/src/clustering";
import { createDb } from "../apps/server/src/db/connection";
import { migrateToLatest } from "../apps/server/src/db/migrate";
import { normalizeFloat32, serializeFloat32 } from "../apps/server/src/embeddings/types";
import { getEmbedder } from "../apps/server/src/queue/embed-job";
import { getArticleEligibilitySettings, isEligibleArticle } from "../apps/server/src/pipeline/article-eligibility";
import { scoreClustersForUser } from "../apps/server/src/scoring";
import { processAssembleDigestJob } from "../apps/server/src/synthesis/assemble-digest";
import { processSynthesizeClusterJob } from "../apps/server/src/synthesis/synthesize-cluster";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const EMBEDDING_BATCH_SIZE = 100;
const MANUAL_STAGE_EXPECTED = 100_000;
const MAX_USERS = Number(process.env.VAGUS_PIPELINE_MAX_USERS ?? 1);
const ENABLE_LLM_MERGE = process.env.VAGUS_PIPELINE_LLM_MERGE === "true";

const db = createDb(DEV_DB_PATH);
try {
	console.log("[pipeline] Applying local migrations...");
	await migrateToLatest(db.kysely);
	const run = await db.kysely
		.insertInto("run")
		.values({ trigger: "manual", status: "running", started_at: new Date().toISOString(), finished_at: null })
		.returning("id")
		.executeTakeFirstOrThrow();
	console.log(`[pipeline] Run ${run.id}: assigning imported articles...`);
	await db.kysely.updateTable("article").set({ run_id: run.id }).execute();

	const eligibilitySettings = await getArticleEligibilitySettings(db.kysely);
	const articles = (await db.kysely.selectFrom("article").select(["id", "title", "content", "stage_a_bullet", "publish_date"]).where("run_id", "=", run.id).execute()).filter((article) => isEligibleArticle(article, eligibilitySettings));
	console.log(`[pipeline] Run ${run.id}: rebuilding ${articles.length} embeddings in ${Math.ceil(articles.length / EMBEDDING_BATCH_SIZE)} batches...`);
	await db.kysely.deleteFrom("article_embedding").execute();
	const embedder = await getEmbedder(db.kysely);
	for (let start = 0; start < articles.length; start += EMBEDDING_BATCH_SIZE) {
		const batch = articles.slice(start, start + EMBEDDING_BATCH_SIZE);
		console.log(`[pipeline] Embedding batch ${start / EMBEDDING_BATCH_SIZE + 1}/${Math.ceil(articles.length / EMBEDDING_BATCH_SIZE)}...`);
		const vectors = await embedder.embedBatch(batch.map((article) => [article.title, article.stage_a_bullet].filter(Boolean).join("\n\n")));
		await db.kysely.insertInto("article_embedding").values(batch.map((article, index) => ({ article_id: article.id, embedding: serializeFloat32(normalizeFloat32(vectors[index])), model_name: embedder.getModelName(), created_at: new Date().toISOString() }))).execute();
	}

	const settings = new Map((await db.kysely.selectFrom("system_setting").select(["key", "value"]).execute()).map((row) => [row.key, row.value]));
	console.log(`[pipeline] Clustering ${articles.length} articles${ENABLE_LLM_MERGE ? " with LLM topic validation" : " deterministically"}...`);
	const clustering = await clusterRunArticles(db.kysely, run.id, {
		threshold: Number(settings.get("clustering_similarity_threshold") ?? 0.8),
		llmMergeEnabled: ENABLE_LLM_MERGE && settings.get("clustering_llm_merge_enabled") !== "false",
		topicSubclusterThreshold: Number(settings.get("clustering_topic_subcluster_threshold") ?? 0.65),
		topicValidationMaxBuckets: Number(settings.get("clustering_topic_validation_max_buckets") ?? 20),
	});
	console.log(`[pipeline] Created ${clustering.clusters.length} clusters.`);

	const users = (await db.kysely.selectFrom("user").select("id").where("isDisabled", "=", 0).execute()).slice(0, MAX_USERS);
	const synthesisStage = await db.kysely.insertInto("run_stage").values({ run_id: run.id, stage: "manual-synthesis", expected: MANUAL_STAGE_EXPECTED, completed: 0, status: "running" }).returning("id").executeTakeFirstOrThrow();
	let synthesisJobs = 0;
	for (const user of users) {
		const selections = await scoreClustersForUser(db.kysely, run.id, user.id);
		console.log(`[pipeline] User ${user.id}: synthesizing ${selections.length} selected clusters...`);
		for (const selection of selections) {
			console.log(`[pipeline] Synthesizing cluster ${selection.clusterId} (${++synthesisJobs})...`);
			await processSynthesizeClusterJob(db.kysely, { id: synthesisJobs, data: { runId: run.id, stageId: synthesisStage.id, userId: user.id, clusterId: selection.clusterId } } as any);
		}
	}

	const assemblyStage = await db.kysely.insertInto("run_stage").values({ run_id: run.id, stage: "manual-assembly", expected: MANUAL_STAGE_EXPECTED, completed: 0, status: "running" }).returning("id").executeTakeFirstOrThrow();
	let digestCount = 0;
	for (const user of users) {
		const digest = await db.kysely.selectFrom("digest").select("id").where("run_id", "=", run.id).where("user_id", "=", user.id).executeTakeFirst();
		if (!digest) continue;
		console.log(`[pipeline] Assembling digest for user ${user.id}...`);
		await processAssembleDigestJob(db.kysely, { id: ++digestCount, data: { runId: run.id, stageId: assemblyStage.id, userId: user.id } } as any);
	}

	await db.kysely.updateTable("run").set({ status: "complete", finished_at: new Date().toISOString() }).where("id", "=", run.id).execute();
	console.log(`[pipeline] Complete: run ${run.id}, ${clustering.clusters.length} clusters, ${synthesisJobs} synthesized clusters, ${digestCount} digests.`);
} finally {
	db.close();
}
