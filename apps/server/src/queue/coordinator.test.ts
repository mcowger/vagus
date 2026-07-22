import { expect, test } from "bun:test";
import { defineWorker } from "plainjob";
import { createDb } from "../db/connection";
import { migrateToLatest } from "../db/migrate";
import { createPlainjobConnection } from "./index";
import { defineQueue } from "plainjob";
import { advanceStage, getRun, listRuns, startRun } from "./coordinator";
import { NOOP_JOB_TYPE, noopProcessor, type NoopJobData } from "./jobs";

test("(a) startRun creates a run + stage and enqueues N jobs", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const result = await startRun(db.kysely, queue, "manual", { expectedJobs: 3 });
	expect(result.started).toBe(true);
	if (!result.started) return;

	expect(result.runId).toBeDefined();
	expect(result.stageId).toBeDefined();

	const run = await getRun(db.kysely, result.runId);
	expect(run).not.toBeNull();
	expect(run?.trigger).toBe("manual");
	expect(run?.status).toBe("running");
	expect(run?.stages.length).toBe(1);
	expect(run?.stages[0].expected).toBe(3);
	expect(run?.stages[0].completed).toBe(0);
	expect(run?.stages[0].status).toBe("running");

	const jobCount = queue.countJobs({ type: NOOP_JOB_TYPE });
	expect(jobCount).toBe(3);

	queue.close();
	db.close();
});

test("(b) overlap guard rejects a 2nd concurrent run while one is running", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const run1 = await startRun(db.kysely, queue, "manual");
	expect(run1.started).toBe(true);

	const run2 = await startRun(db.kysely, queue, "cron");
	expect(run2.started).toBe(false);
	if (!run2.started) {
		expect(run2.reason).toBe("overlap");
	}

	queue.close();
	db.close();
});

test("(c) processing all stage jobs advances the stage to complete and marks run complete", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const startRes = await startRun(db.kysely, queue, "manual", { expectedJobs: 2 });
	expect(startRes.started).toBe(true);
	if (!startRes.started) return;

	const { stageId, runId } = startRes;

	// Advance job 1
	const res1 = await advanceStage(db.kysely, stageId, 101);
	expect(res1.advanced).toBe(true);
	expect(res1.completed).toBe(1);
	expect(res1.stageStatus).toBe("running");

	let run = await getRun(db.kysely, runId);
	expect(run?.status).toBe("running");
	expect(run?.finished_at).toBeNull();

	// Advance job 2
	const res2 = await advanceStage(db.kysely, stageId, 102);
	expect(res2.advanced).toBe(true);
	expect(res2.completed).toBe(2);
	expect(res2.stageStatus).toBe("complete");

	run = await getRun(db.kysely, runId);
	expect(run?.status).toBe("complete");
	expect(run?.finished_at).not.toBeNull();

	queue.close();
	db.close();
});

test("(d) advance is idempotent (calling twice doesn't over-count or mark complete twice)", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const startRes = await startRun(db.kysely, queue, "manual", { expectedJobs: 1 });
	expect(startRes.started).toBe(true);
	if (!startRes.started) return;

	const { stageId, runId } = startRes;

	// First advance
	const res1 = await advanceStage(db.kysely, stageId, 1);
	expect(res1.advanced).toBe(true);
	expect(res1.completed).toBe(1);
	expect(res1.stageStatus).toBe("complete");

	// Duplicate advance call with same job ID
	const res2 = await advanceStage(db.kysely, stageId, 1);
	expect(res2.advanced).toBe(false);
	expect(res2.completed).toBe(1);
	expect(res2.stageStatus).toBe("complete");

	// Extra advance call on already completed stage
	const res3 = await advanceStage(db.kysely, stageId, 2);
	expect(res3.advanced).toBe(false);
	expect(res3.completed).toBe(1);

	const run = await getRun(db.kysely, runId);
	expect(run?.status).toBe("complete");
	expect(run?.stages[0].completed).toBe(1);

	queue.close();
	db.close();
});

test("integration: real plainjob worker processes noop job and advances run to complete", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const worker = defineWorker(NOOP_JOB_TYPE, noopProcessor, {
		queue,
		pollIntervall: 50,
		onCompleted: (job) => {
			try {
				const data = JSON.parse(job.data) as NoopJobData;
				if (data?.stageId) {
					void advanceStage(db.kysely, data.stageId, job.id);
				}
			} catch {}
		},
	});

	const workerLoop = worker.start();

	const startRes = await startRun(db.kysely, queue, "manual", { expectedJobs: 1 });
	expect(startRes.started).toBe(true);

	let complete = false;
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 50));
		if (startRes.started) {
			const run = await getRun(db.kysely, startRes.runId);
			if (run?.status === "complete") {
				complete = true;
				break;
			}
		}
	}

	expect(complete).toBe(true);

	await worker.stop();
	await workerLoop;
	queue.close();
	db.close();
});

test("listRuns lists recent runs with stages", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const startRes = await startRun(db.kysely, queue, "manual");
	if (startRes.started) {
		await advanceStage(db.kysely, startRes.stageId, 1);
	}

	const runs = await listRuns(db.kysely);
	expect(runs.length).toBe(1);
	expect(runs[0].status).toBe("complete");
	expect(runs[0].stages.length).toBe(1);

	queue.close();
	db.close();
});
