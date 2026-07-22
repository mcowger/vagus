import type { Kysely, Selectable } from "kysely";
import type { Queue } from "plainjob";
import type { Database, RunStageTable, RunTable, RunTrigger, StageStatus } from "../db/schema";
import { NOOP_JOB_TYPE, type NoopJobData } from "./jobs";

export type StartRunResult =
	| { started: true; runId: number; stageId: number }
	| { started: false; reason: "overlap" };

export async function startRun(
	db: Kysely<Database>,
	queue: Queue,
	trigger: RunTrigger,
	options?: { expectedJobs?: number; stageName?: string },
): Promise<StartRunResult> {
	const expectedJobs = options?.expectedJobs ?? 1;
	const stageName = options?.stageName ?? "noop";

	const existingRunning = await db
		.selectFrom("run")
		.select("id")
		.where("status", "=", "running")
		.executeTakeFirst();

	if (existingRunning) {
		return { started: false, reason: "overlap" };
	}

	return await db.transaction().execute(async (trx) => {
		const runningInsideTrx = await trx
			.selectFrom("run")
			.select("id")
			.where("status", "=", "running")
			.executeTakeFirst();

		if (runningInsideTrx) {
			return { started: false, reason: "overlap" };
		}

		const now = new Date().toISOString();
		const runRow = await trx
			.insertInto("run")
			.values({
				trigger,
				status: "running",
				started_at: now,
				finished_at: null,
				stats: JSON.stringify({ completedJobIds: [] }),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const stageRow = await trx
			.insertInto("run_stage")
			.values({
				run_id: runRow.id,
				stage: stageName,
				expected: expectedJobs,
				completed: 0,
				status: "running",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const jobData: NoopJobData = {
			runId: runRow.id,
			stageId: stageRow.id,
		};

		if (expectedJobs === 1) {
			queue.add(NOOP_JOB_TYPE, jobData);
		} else if (expectedJobs > 1) {
			const items = Array.from({ length: expectedJobs }, () => jobData);
			queue.addMany(NOOP_JOB_TYPE, items);
		}

		return {
			started: true,
			runId: runRow.id,
			stageId: stageRow.id,
		};
	});
}

export interface AdvanceStageResult {
	advanced: boolean;
	completed: number;
	stageStatus: StageStatus;
	reason?: string;
}

export async function advanceStage(
	db: Kysely<Database>,
	stageId: number,
	jobId?: number,
): Promise<AdvanceStageResult> {
	return await db.transaction().execute(async (trx) => {
		const stage = await trx
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", stageId)
			.executeTakeFirst();

		if (!stage) {
			return { advanced: false, completed: 0, stageStatus: "failed", reason: "stage_not_found" };
		}

		if (stage.status === "complete" || stage.status === "failed") {
			return { advanced: false, completed: stage.completed, stageStatus: stage.status, reason: "stage_already_finished" };
		}

		const run = await trx
			.selectFrom("run")
			.selectAll()
			.where("id", "=", stage.run_id)
			.executeTakeFirst();

		if (!run) {
			return { advanced: false, completed: stage.completed, stageStatus: stage.status, reason: "run_not_found" };
		}

		let stats: { completedJobIds?: number[] } = {};
		try {
			if (run.stats) stats = JSON.parse(run.stats);
		} catch {
			stats = {};
		}

		const completedJobIds: number[] = stats.completedJobIds ?? [];

		if (jobId !== undefined && completedJobIds.includes(jobId)) {
			return { advanced: false, completed: stage.completed, stageStatus: stage.status, reason: "duplicate_job" };
		}

		if (jobId !== undefined) {
			completedJobIds.push(jobId);
			stats.completedJobIds = completedJobIds;
		}

		const newCompleted = Math.min(stage.completed + 1, stage.expected);
		const isStageComplete = newCompleted >= stage.expected;
		const nextStageStatus: StageStatus = isStageComplete ? "complete" : "running";

		await trx
			.updateTable("run_stage")
			.set({
				completed: newCompleted,
				status: nextStageStatus,
			})
			.where("id", "=", stageId)
			.execute();

		if (isStageComplete) {
			const remainingIncomplete = await trx
				.selectFrom("run_stage")
				.select("id")
				.where("run_id", "=", stage.run_id)
				.where("id", "!=", stageId)
				.where("status", "!=", "complete")
				.execute();

			if (remainingIncomplete.length === 0) {
				const now = new Date().toISOString();
				await trx
					.updateTable("run")
					.set({
						status: "complete",
						finished_at: now,
						stats: JSON.stringify(stats),
					})
					.where("id", "=", stage.run_id)
					.execute();
			} else {
				await trx
					.updateTable("run")
					.set({
						stats: JSON.stringify(stats),
					})
					.where("id", "=", stage.run_id)
					.execute();
			}
		} else {
			await trx
				.updateTable("run")
				.set({
					stats: JSON.stringify(stats),
				})
				.where("id", "=", stage.run_id)
				.execute();
		}

		return {
			advanced: true,
			completed: newCompleted,
			stageStatus: nextStageStatus,
		};
	});
}

export type RunWithStages = Selectable<RunTable> & { stages: Selectable<RunStageTable>[] };

export async function listRuns(
	db: Kysely<Database>,
	limit = 50,
): Promise<RunWithStages[]> {
	const runs = await db
		.selectFrom("run")
		.selectAll()
		.orderBy("id", "desc")
		.limit(limit)
		.execute();

	if (runs.length === 0) return [];

	const runIds = runs.map((r) => r.id);
	const stages = await db
		.selectFrom("run_stage")
		.selectAll()
		.where("run_id", "in", runIds)
		.execute();

	const stagesByRunId = new Map<number, Selectable<RunStageTable>[]>();
	for (const stage of stages) {
		const existing = stagesByRunId.get(stage.run_id) ?? [];
		existing.push(stage);
		stagesByRunId.set(stage.run_id, existing);
	}

	return runs.map((run) => ({
		...run,
		stages: stagesByRunId.get(run.id) ?? [],
	}));
}

export async function getRun(
	db: Kysely<Database>,
	runId: number,
): Promise<RunWithStages | null> {
	const run = await db
		.selectFrom("run")
		.selectAll()
		.where("id", "=", runId)
		.executeTakeFirst();

	if (!run) return null;

	const stages = await db
		.selectFrom("run_stage")
		.selectAll()
		.where("run_id", "=", runId)
		.execute();

	return {
		...run,
		stages,
	};
}
