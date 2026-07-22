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
		await clusterRunArticles(db, runId);
		log.info("Completed cluster-run job", { jobId: job.id, runId });
	} catch (err) {
		log.error("Failed cluster-run job execution", { jobId: job.id, runId, error: String(err) });
	} finally {
		await advanceStage(db, stageId, job.id);
	}
}
