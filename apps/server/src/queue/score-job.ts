import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { getDb, type Database } from "../db";
import { log } from "../log";
import { scoreClustersForUser } from "../scoring";
import { SCORE_USER_JOB_TYPE, type ScoreUserJobData } from "./clustering-contracts";
import { advanceStage } from "./coordinator";

export async function processScoreUserJob(
	db: Kysely<Database> | null | undefined,
	job: Job,
): Promise<void> {
	let data: ScoreUserJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as ScoreUserJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as ScoreUserJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, userId } = data;

	log.info("Starting score-user job", { jobId: job.id, userId, runId });

	const database = getDb(db);

	try {
		await scoreClustersForUser(database, runId, userId);
		log.info("Completed score-user job", { jobId: job.id, userId, runId });
	} catch (err) {
		log.error("Failed score-user job execution", {
			jobId: job.id,
			userId,
			runId,
			error: String(err),
		});
	} finally {
		await advanceStage(database, stageId, job.id);
	}
}
