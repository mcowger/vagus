import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { clusterRunArticles } from "../clustering";
import { getDb, type Database } from "../db";
import { log } from "../log";
import { CLUSTER_RUN_JOB_TYPE, type ClusterRunJobData } from "./clustering-contracts";
import { advanceStage } from "./coordinator";

export async function processClusterRunJob(
	dbOrJob: Kysely<Database> | Job,
	jobArg?: Job,
): Promise<void> {
	let db: Kysely<Database>;
	let job: Job;

	if ("data" in dbOrJob && jobArg === undefined) {
		job = dbOrJob as Job;
		db = getDb();
	} else {
		db = dbOrJob as Kysely<Database>;
		job = jobArg as Job;
	}

	let data: ClusterRunJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as ClusterRunJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as ClusterRunJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId } = data;

	log.info("Starting cluster-run job", { jobId: job.id, runId, stageId });

	try {
		const settings = await db
			.selectFrom("system_setting")
			.select(["key", "value"])
			.where("key", "in", [
				"clustering_similarity_threshold",
				"clustering_llm_merge_enabled",
				"clustering_topic_subcluster_threshold",
				"clustering_topic_validation_max_buckets",
			])
			.execute();
		const setting = new Map(settings.map((row) => [row.key, row.value]));
		await clusterRunArticles(db, runId, {
			threshold: Number(setting.get("clustering_similarity_threshold") ?? 0.8),
			llmMergeEnabled: setting.get("clustering_llm_merge_enabled") !== "false",
			topicSubclusterThreshold: Number(setting.get("clustering_topic_subcluster_threshold") ?? 0.65),
			topicValidationMaxBuckets: Number(setting.get("clustering_topic_validation_max_buckets") ?? 20),
		});
		log.info("Completed cluster-run job", { jobId: job.id, runId });
	} catch (err) {
		log.error("Failed cluster-run job execution", { jobId: job.id, runId, error: String(err) });
	} finally {
		await advanceStage(db, stageId, job.id);
	}
}
