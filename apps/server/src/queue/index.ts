import type { Database as BunDatabase } from "bun:sqlite";
import { bun, defineQueue, defineWorker, type Connection, type Queue, type Worker } from "plainjob";
import { db } from "../db/connection";
import { log } from "../log";
import { advanceStage } from "./coordinator";
import {
	CLUSTER_RUN_JOB_TYPE,
	EMBED_ARTICLE_JOB_TYPE,
	SCORE_USER_JOB_TYPE,
} from "./clustering-contracts";
import { processClusterRunJob } from "./cluster-job";
import {
	EXTRACT_ARTICLE_JOB_TYPE,
	STAGE_A_BULLET_JOB_TYPE,
} from "./extraction-contracts";
import { processEmbedArticleJob } from "./embed-job";
import { processExtractArticleJob } from "./extract-job";
import { processScoreUserJob } from "./score-job";
import { FETCH_SOURCE_JOB_TYPE, processFetchSourceJob } from "./ingestion";
import { NOOP_JOB_TYPE, noopProcessor, type NoopJobData } from "./jobs";
import { processStageABulletJob } from "./stage-a-job";
import { ASSEMBLE_DIGEST_JOB_TYPE, SYNTHESIZE_CLUSTER_JOB_TYPE } from "./synthesis-contracts";
import { processSynthesizeClusterJob } from "../synthesis/synthesize-cluster";
import { processAssembleDigestJob } from "../synthesis/assemble-digest";

/**
 * Wraps plainjob's `bun(sqlite)` connection to normalize named parameter keys.
 * `bun:sqlite` requires `@param` / `$param` keys when SQL uses `@param` placeholdes.
 */
export function createPlainjobConnection(sqlite: BunDatabase): Connection {
	const conn = bun(sqlite);
	const origPrepare = conn.prepare.bind(conn);
	conn.prepare = (sql: string) => {
		const stmt = origPrepare(sql);
		const origRun = stmt.run.bind(stmt);
		const origGet = stmt.get.bind(stmt);
		const origAll = stmt.all.bind(stmt);

		const mapParams = (params: unknown) => {
			if (params && typeof params === "object" && !Array.isArray(params)) {
				const mapped: Record<string, unknown> = { ...(params as Record<string, unknown>) };
				for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
					if (!k.startsWith("@") && !k.startsWith("$")) {
						mapped[`@${k}`] = v;
						mapped[`$${k}`] = v;
					}
				}
				return mapped;
			}
			return params;
		};

		stmt.run = (param?: unknown) => origRun(mapParams(param));
		stmt.get = (param?: unknown) => origGet(mapParams(param));
		stmt.all = (param?: unknown) => origAll(mapParams(param));

		return stmt;
	};
	return conn;
}

export const queue: Queue = defineQueue({
	connection: createPlainjobConnection(db.sqlite),
	logger: log,
});

let activeWorkers: Worker[] = [];

export async function getWorkerConcurrencyFromDb(): Promise<number> {
	try {
		const setting = await db.kysely
			.selectFrom("system_setting")
			.select("value")
			.where("key", "=", "worker_concurrency")
			.executeTakeFirst();

		if (setting?.value) {
			const parsed = parseInt(setting.value, 10);
			if (!isNaN(parsed) && parsed >= 1) {
				return parsed;
			}
		}
	} catch {}
	return 5; // Default concurrency
}

export async function startWorker(): Promise<void> {
	if (activeWorkers.length > 0) return;

	// Reset any abandoned processing jobs from server restarts
	try {
		queue.requeueTimedOutJobs(0);
	} catch (err) {
		log.warn("Failed to requeue timed out jobs on startup", { error: String(err) });
	}

	const concurrency = await getWorkerConcurrencyFromDb();
	log.info("Starting worker pool with database concurrency", { concurrency });

	// Noop worker (1 instance for testing/idle checks)
	const noopWorker = defineWorker(NOOP_JOB_TYPE, noopProcessor, {
		queue,
		logger: log,
		onCompleted: (job) => {
			try {
				const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as NoopJobData;
				if (data?.stageId) {
					void advanceStage(db.kysely, data.stageId, job.id, queue);
				}
			} catch (err) {
				log.error("Failed to advance stage on job completion", {
					error: String(err),
					jobId: job.id,
				});
			}
		},
	});
	activeWorkers.push(noopWorker);

	// Cluster worker (1 instance for global DBSCAN clustering execution)
	const clusterWorker = defineWorker(
		CLUSTER_RUN_JOB_TYPE,
		(job) => processClusterRunJob(db.kysely, job),
		{ queue, logger: log },
	);
	activeWorkers.push(clusterWorker);

	// Parallelizable worker pool instances (concurrency instances per job type)
	for (let i = 0; i < concurrency; i++) {
		activeWorkers.push(
			defineWorker(FETCH_SOURCE_JOB_TYPE, (job) => processFetchSourceJob(db.kysely, job), { queue, logger: log }),
			defineWorker(EXTRACT_ARTICLE_JOB_TYPE, (job) => processExtractArticleJob(db.kysely, job), { queue, logger: log }),
			defineWorker(STAGE_A_BULLET_JOB_TYPE, (job) => processStageABulletJob(db.kysely, queue, job), { queue, logger: log }),
			defineWorker(EMBED_ARTICLE_JOB_TYPE, (job) => processEmbedArticleJob(db.kysely, job), { queue, logger: log }),
			defineWorker(SCORE_USER_JOB_TYPE, (job) => processScoreUserJob(db.kysely, job), { queue, logger: log }),
			defineWorker(SYNTHESIZE_CLUSTER_JOB_TYPE, (job) => processSynthesizeClusterJob(db.kysely, queue, job), { queue, logger: log }),
			defineWorker(ASSEMBLE_DIGEST_JOB_TYPE, (job) => processAssembleDigestJob(db.kysely, job), { queue, logger: log }),
		);
	}

	for (const w of activeWorkers) {
		void w.start().catch((err) => {
			log.error("Worker in pool crashed on start", { error: String(err) });
		});
	}
}

export async function stopWorker(): Promise<void> {
	for (const w of activeWorkers) {
		await w.stop();
	}
	activeWorkers = [];
	queue.close();
}

export {
	advanceStage,
	getRun,
	listRuns,
	startRun,
	type StartRunResult,
	type AdvanceStageResult,
	type RunWithStages,
} from "./coordinator";
