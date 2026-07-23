import { afterEach, expect, test } from "bun:test";
import { defineQueue, type Queue } from "plainjob";
import { createDb } from "../db/connection";
import { migrateToLatest } from "../db/migrate";
import { advanceStage, getRun, listRuns } from "../queue/coordinator";
import { createPlainjobConnection } from "../queue/index";
import {
	parseScheduleInterval,
	getNextCronRun,
	startScheduler,
	stopScheduler,
	triggerManualRun,
	triggerManualProfileRun,
	isSchedulerRunning,
} from "./index";

afterEach(() => {
	stopScheduler();
});

	test("parseScheduleInterval only parses explicit duration schedules", () => {
	expect(parseScheduleInterval("100")).toBe(100);
	expect(parseScheduleInterval("250ms")).toBe(250);
	expect(parseScheduleInterval("5s")).toBe(5000);
	expect(parseScheduleInterval("2m")).toBe(120000);
	expect(parseScheduleInterval("1h")).toBe(3600000);
		expect(parseScheduleInterval("0 * * * *")).toBeNull();
	});

	test("cron schedules run at calendar boundaries instead of process-relative intervals", () => {
		const nextRun = getNextCronRun("0 * * * *", new Date("2026-07-23T05:58:27.000Z"));

		expect(nextRun?.toISOString()).toBe("2026-07-23T06:00:00.000Z");
	});

test("starts a scheduled run", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	await startScheduler(db.kysely, queue, { runImmediately: true });

	const runs = await listRuns(db.kysely);
	expect(runs.length).toBe(1);
	expect(runs[0].trigger).toBe("cron");
	expect(runs[0].status).toBe("running");

	queue.close();
	db.close();
});

test("rejects an overlapping manual run while a run is in progress", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	await startScheduler(db.kysely, queue, { runImmediately: true });

	const runsBefore = await listRuns(db.kysely);
	expect(runsBefore.length).toBe(1);
	expect(runsBefore[0].status).toBe("running");

	const manualResult = await triggerManualRun(db.kysely, queue);
	expect(manualResult.started).toBe(false);
	if (!manualResult.started) {
		expect(manualResult.reason).toBe("overlap");
	}

	queue.close();
	db.close();
});

test("allows a subsequent run after the active run completes", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	// Start initial run
	const initialRun = await triggerManualRun(db.kysely, queue, { expectedJobs: 1 });
	expect(initialRun.started).toBe(true);
	if (!initialRun.started) return;

	// Verify overlapping run is rejected while initial run is in progress
	const overlapAttempt = await triggerManualRun(db.kysely, queue);
	expect(overlapAttempt.started).toBe(false);

	// Complete initial run stage
	const stageRes = await advanceStage(db.kysely, initialRun.stageId, 1);
	expect(stageRes.stageStatus).toBe("complete");

	const completedRun = await getRun(db.kysely, initialRun.runId);
	expect(completedRun?.status).toBe("complete");

	// Trigger subsequent run now that active run has completed
	const subsequentRun = await triggerManualRun(db.kysely, queue);
	expect(subsequentRun.started).toBe(true);
	if (subsequentRun.started) {
		expect(subsequentRun.runId).not.toBe(initialRun.runId);
		const newRun = await getRun(db.kysely, subsequentRun.runId);
		expect(newRun?.status).toBe("running");
	}

	queue.close();
	db.close();
});

test("scheduler ticking automatically triggers cron run based on interval", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	// Configure fast interval in system_setting
	await db.kysely
		.updateTable("system_setting")
		.set({ value: "20ms" })
		.where("key", "=", "cron_schedule")
		.execute();

	await startScheduler(db.kysely, queue);

	// Wait for ticking interval to trigger
	await new Promise((r) => setTimeout(r, 60));

	const runs = await listRuns(db.kysely);
	expect(runs.length).toBeGreaterThanOrEqual(1);
	expect(runs[0].trigger).toBe("cron");

	queue.close();
	db.close();
});

test("startScheduler sets up profile crons and stopScheduler cleans them up", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	// Create a profile with schedule_enabled = 1
	await db.kysely
		.insertInto("interest_profile")
		.values({
			user_id: "user-sched",
			name: "Scheduled Profile",
			keywords: JSON.stringify([]),
			topics: JSON.stringify([]),
			entities: JSON.stringify([]),
			include_rules: JSON.stringify([]),
			exclude_rules: JSON.stringify([]),
			similarity_threshold: 0.65,
			max_cluster_cap: 10,
			schedule_enabled: 1 as any,
			schedule_cron: "0 9 * * *" as any,
			schedule_timezone: "America/Los_Angeles" as any,
			is_default: 1,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		} as any)
		.execute();

	await startScheduler(db.kysely, queue);
	expect(isSchedulerRunning()).toBe(true);

	stopScheduler();
	expect(isSchedulerRunning()).toBe(false);

	queue.close();
	db.close();
});

test("triggerManualProfileRun triggers a profile run when new embedded articles exist", async () => {
	const { serializeFloat32 } = await import("../embeddings/types");

	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	const queue = defineQueue({ connection: createPlainjobConnection(db.sqlite) });

	const profile = await db.kysely
		.insertInto("interest_profile")
		.values({
			user_id: "user-manual",
			name: "Manual Profile",
			keywords: JSON.stringify([]),
			topics: JSON.stringify([]),
			entities: JSON.stringify([]),
			include_rules: JSON.stringify([]),
			exclude_rules: JSON.stringify([]),
			similarity_threshold: 0.65,
			max_cluster_cap: 10,
			cursor_article_id: null as any,
			is_default: 1,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		} as any)
		.returningAll()
		.executeTakeFirstOrThrow();

	// Insert source, article, embedding
	const source = await db.kysely
		.insertInto("source")
		.values({ type: "rss", name: "Source 1", enabled: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
		.returningAll()
		.executeTakeFirstOrThrow();

	const article = await db.kysely
		.insertInto("article")
		.values({
			identity_key: "manual-art-1",
			source_id: source.id,
			title: "Manual Article",
			url: "https://example.com/manual-1",
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

	const res = await triggerManualProfileRun(db.kysely, queue, profile.id);
	expect(res.started).toBe(true);

	queue.close();
	db.close();
});
