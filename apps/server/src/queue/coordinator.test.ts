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

test("global workflow stops after embed stage and does not cascade to cluster", async () => {
	const { triggerNextStage, startRun } = await import("./coordinator");
	const { CLUSTER_RUN_JOB_TYPE } = await import("./clustering-contracts");

	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const startRes = await startRun(db.kysely, queue, "manual");
	expect(startRes.started).toBe(true);

	if (startRes.started) {
		await triggerNextStage(db.kysely, queue, startRes.runId, "embed");
		const clusterJobs = queue.countJobs({ type: CLUSTER_RUN_JOB_TYPE });
		expect(clusterJobs).toBe(0);
	}

	queue.close();
	db.close();
});

test("startProfileRun handles profile not found, bounds, and profile overlap", async () => {
	const { startProfileRun, startRun } = await import("./coordinator");
	const { serializeFloat32 } = await import("../embeddings/types");

	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	// 1. Non-existent profile
	const notFoundRes = await startProfileRun(db.kysely, queue, "manual", 9999);
	expect(notFoundRes.started).toBe(false);
	if (!notFoundRes.started) expect(notFoundRes.reason).toBe("profile_not_found");

	// Create profile
	const profile = await db.kysely
		.insertInto("interest_profile")
		.values({
			user_id: "user-1",
			name: "Tech Profile",
			keywords: JSON.stringify([]),
			topics: JSON.stringify([]),
			entities: JSON.stringify([]),
			include_rules: JSON.stringify([]),
			exclude_rules: JSON.stringify([]),
			similarity_threshold: 0.65,
			max_cluster_cap: 10,
			ntfy_topic: null,
			is_default: 1,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	// 2. No embedded articles -> no_new_articles
	const noArticlesRes = await startProfileRun(db.kysely, queue, "manual", profile.id);
	expect(noArticlesRes.started).toBe(false);
	if (!noArticlesRes.started) expect(noArticlesRes.reason).toBe("no_new_articles");

	// Add source, article, and embedding
	const source = await db.kysely
		.insertInto("source")
		.values({ type: "rss", name: "Source 1", enabled: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
		.returningAll()
		.executeTakeFirstOrThrow();

	const article = await db.kysely
		.insertInto("article")
		.values({
			identity_key: "art-1",
			source_id: source.id,
			title: "Article 1",
			url: "https://example.com/1",
			fetched_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	await db.kysely
		.insertInto("article_embedding")
		.values({
			article_id: article.id,
			embedding: serializeFloat32(new Float32Array([1, 0, 0])),
			model_name: "test-model",
			created_at: new Date().toISOString(),
		})
		.execute();

	// 3. Global run can run concurrently with profile run
	const globalRes = await startRun(db.kysely, queue, "manual");
	expect(globalRes.started).toBe(true);

	// Profile run starts successfully alongside running global run
	const profileRes1 = await startProfileRun(db.kysely, queue, "manual", profile.id);
	expect(profileRes1.started).toBe(true);

	// 4. Second profile run for same profile is rejected due to overlap
	const profileRes2 = await startProfileRun(db.kysely, queue, "manual", profile.id);
	expect(profileRes2.started).toBe(false);
	if (!profileRes2.started) expect(profileRes2.reason).toBe("overlap");

	queue.close();
	db.close();
});
