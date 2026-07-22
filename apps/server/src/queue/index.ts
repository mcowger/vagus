import type { Database as BunDatabase } from "bun:sqlite";
import { bun, defineQueue, defineWorker, type Connection, type Queue, type Worker } from "plainjob";
import { db } from "../db/connection";
import { log } from "../log";
import { advanceStage } from "./coordinator";
import {
	CLUSTER_RUN_JOB_TYPE,
	EMBED_ARTICLE_JOB_TYPE,
	SCORE_USER_JOB_TYPE,
	type ClusterRunJobData,
	type EmbedArticleJobData,
	type ScoreUserJobData,
} from "./clustering-contracts";
import { processClusterRunJob } from "./cluster-job";
import {
	EXTRACT_ARTICLE_JOB_TYPE,
	STAGE_A_BULLET_JOB_TYPE,
	type ExtractArticleJobData,
	type StageABulletJobData,
} from "./extraction-contracts";
import { processEmbedArticleJob } from "./embed-job";
import { processExtractArticleJob } from "./extract-job";
import { FETCH_SOURCE_JOB_TYPE, processFetchSourceJob } from "./ingestion";
import { NOOP_JOB_TYPE, noopProcessor, type NoopJobData } from "./jobs";
import { processStageABulletJob } from "./stage-a-job";

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

let noopWorker: Worker | null = null;
let fetchWorker: Worker | null = null;
let extractWorker: Worker | null = null;
let stageABulletWorker: Worker | null = null;
let embedWorker: Worker | null = null;
let clusterWorker: Worker | null = null;
let scoreUserWorker: Worker | null = null;

export async function startWorker(): Promise<void> {
	if (noopWorker) return;

	noopWorker = defineWorker(NOOP_JOB_TYPE, noopProcessor, {
		queue,
		logger: log,
		onCompleted: (job) => {
			try {
				const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as NoopJobData;
				if (data?.stageId) {
					void advanceStage(db.kysely, data.stageId, job.id);
				}
			} catch (err) {
				log.error("Failed to advance stage on job completion", {
					error: String(err),
					jobId: job.id,
				});
			}
		},
	});

	fetchWorker = defineWorker(
		FETCH_SOURCE_JOB_TYPE,
		(job) => processFetchSourceJob(db.kysely, job),
		{
			queue,
			logger: log,
			concurrency: 5, // Stage per-stage concurrency limit
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as FetchSourceJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on fetch job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	extractWorker = defineWorker(
		EXTRACT_ARTICLE_JOB_TYPE,
		(job) => processExtractArticleJob(db.kysely, job),
		{
			queue,
			logger: log,
			concurrency: 5,
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as ExtractArticleJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on extract job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	stageABulletWorker = defineWorker(
		STAGE_A_BULLET_JOB_TYPE,
		(job) => processStageABulletJob(db.kysely, queue, job),
		{
			queue,
			logger: log,
			concurrency: 5,
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as StageABulletJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on stage-a job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	scoreUserWorker = defineWorker(
		SCORE_USER_JOB_TYPE,
		(job) => processScoreUserJob(db.kysely, job),
		{
			queue,
			logger: log,
			concurrency: 5,
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as ScoreUserJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on score-user job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	embedWorker = defineWorker(
		EMBED_ARTICLE_JOB_TYPE,
		(job) => processEmbedArticleJob(db.kysely, job),
		{
			queue,
			logger: log,
			concurrency: 5,
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as EmbedArticleJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on embed job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	clusterWorker = defineWorker(
		CLUSTER_RUN_JOB_TYPE,
		(job) => processClusterRunJob(db.kysely, job),
		{
			queue,
			logger: log,
			concurrency: 1,
			onCompleted: (job) => {
				try {
					const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as ClusterRunJobData;
					if (data?.stageId) {
						void advanceStage(db.kysely, data.stageId, job.id);
					}
				} catch (err) {
					log.error("Failed to advance stage on cluster job completion", {
						error: String(err),
						jobId: job.id,
					});
				}
			},
		},
	);

	void noopWorker.start().catch((err) => {
		log.error("Noop worker crashed", { error: String(err) });
	});

	void fetchWorker.start().catch((err) => {
		log.error("Fetch worker crashed", { error: String(err) });
	});

	void extractWorker.start().catch((err) => {
		log.error("Extract worker crashed", { error: String(err) });
	});

	void stageABulletWorker.start().catch((err) => {
		log.error("Stage A Bullet worker crashed", { error: String(err) });
	});

	void scoreUserWorker.start().catch((err) => {
		log.error("Score User worker crashed", { error: String(err) });
	});

	void embedWorker.start().catch((err) => {
		log.error("Embed worker crashed", { error: String(err) });
	});

	void clusterWorker.start().catch((err) => {
		log.error("Cluster worker crashed", { error: String(err) });
	});
}

export async function stopWorker(): Promise<void> {
	if (noopWorker) {
		await noopWorker.stop();
		noopWorker = null;
	}
	if (fetchWorker) {
		await fetchWorker.stop();
		fetchWorker = null;
	}
	if (extractWorker) {
		await extractWorker.stop();
		extractWorker = null;
	}
	if (stageABulletWorker) {
		await stageABulletWorker.stop();
		stageABulletWorker = null;
	}
	if (clusterWorker) {
		await clusterWorker.stop();
		clusterWorker = null;
	}
	if (embedWorker) {
		await embedWorker.stop();
		embedWorker = null;
	}
	if (scoreUserWorker) {
		await scoreUserWorker.stop();
		scoreUserWorker = null;
	}
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
