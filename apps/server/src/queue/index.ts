import type { Database as BunDatabase } from "bun:sqlite";
import { bun, defineQueue, defineWorker, type Connection, type Queue, type Worker } from "plainjob";
import { db } from "../db/connection";
import { log } from "../log";
import { advanceStage } from "./coordinator";
import { NOOP_JOB_TYPE, noopProcessor, type NoopJobData } from "./jobs";

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

let worker: Worker | null = null;
let workerPromise: Promise<void> | null = null;

export async function startWorker(): Promise<void> {
	if (worker) return;

	worker = defineWorker(NOOP_JOB_TYPE, noopProcessor, {
		queue,
		logger: log,
		onCompleted: (job) => {
			try {
				const data = JSON.parse(job.data) as NoopJobData;
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

	workerPromise = worker.start().catch((err) => {
		log.error("Worker crashed", { error: String(err) });
	});
}

export async function stopWorker(): Promise<void> {
	if (worker) {
		await worker.stop();
		worker = null;
		workerPromise = null;
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
