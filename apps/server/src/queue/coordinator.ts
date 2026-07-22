import type { Kysely, Selectable } from "kysely";
import type { Queue } from "plainjob";
import type { Database, RunStageTable, RunTable, RunTrigger, StageStatus } from "../db/schema";
import { log } from "../log";
import {
	CLUSTER_RUN_JOB_TYPE,
	EMBED_ARTICLE_JOB_TYPE,
	SCORE_USER_JOB_TYPE,
} from "./clustering-contracts";
import {
	EXTRACT_ARTICLE_JOB_TYPE,
	STAGE_A_BULLET_JOB_TYPE,
} from "./extraction-contracts";
import { FETCH_SOURCE_JOB_TYPE, type FetchSourceJobData } from "./ingestion";
import { NOOP_JOB_TYPE, type NoopJobData } from "./jobs";
import {
	ASSEMBLE_DIGEST_JOB_TYPE,
	SYNTHESIZE_CLUSTER_JOB_TYPE,
} from "./synthesis-contracts";

let cachedQueue: Queue | null = null;
async function resolveQueue(queueArg?: Queue): Promise<Queue | null> {
	if (queueArg) return queueArg;
	if (cachedQueue) return cachedQueue;
	try {
		const mod = await import("./index");
		cachedQueue = mod.queue;
		return cachedQueue;
	} catch {
		return null;
	}
}

export type StartRunResult =
	| { started: true; runId: number; stageId: number }
	| { started: false; reason: "overlap" | "no_enabled_sources" };

export async function startRun(
	db: Kysely<Database>,
	queue: Queue,
	trigger: RunTrigger,
	options?: { expectedJobs?: number; stageName?: string },
): Promise<StartRunResult> {
	const existingRunning = await db
		.selectFrom("run")
		.select("id")
		.where("status", "=", "running")
		.executeTakeFirst();

	if (existingRunning) {
		return { started: false, reason: "overlap" };
	}

	// Fetch enabled sources
	const sources = await db
		.selectFrom("source")
		.select("id")
		.where("enabled", "=", 1)
		.execute();

	const isExplicitStage = options?.stageName !== undefined || options?.expectedJobs !== undefined;

	if (sources.length === 0 && !isExplicitStage) {
		// Default to noop if no sources exist
		options = { stageName: "noop", expectedJobs: 1, ...options };
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
				stats: JSON.stringify({ completedJobIds: [], isExplicitStage }),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const stageName = options?.stageName ?? (sources.length > 0 ? "ingest" : "noop");
		const isNoop = stageName === "noop" || (sources.length === 0 && stageName !== "ingest");
		const expectedJobs = options?.expectedJobs ?? (isNoop ? 1 : sources.length);

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

		if (isNoop) {
			const jobData: NoopJobData = {
				runId: runRow.id,
				stageId: stageRow.id,
			};
			for (let i = 0; i < expectedJobs; i++) {
				queue.add(NOOP_JOB_TYPE, jobData);
			}
		} else if (stageName === "ingest") {
			for (const s of sources) {
				const fetchJob: FetchSourceJobData = {
					runId: runRow.id,
					stageId: stageRow.id,
					sourceId: s.id,
				};
				queue.add(FETCH_SOURCE_JOB_TYPE, fetchJob);
			}
		}

		return {
			started: true,
			runId: runRow.id,
			stageId: stageRow.id,
		};
	});
}

export async function triggerNextStage(
	db: Kysely<Database>,
	queue: Queue,
	runId: number,
	completedStage: string,
): Promise<void> {
	log.info("Triggering next pipeline stage", { runId, completedStage });

	if (completedStage === "ingest" || completedStage === "fetch-source") {
		// Ingest -> Extract
		const articles = await db
			.selectFrom("article")
			.selectAll()
			.where((eb) => eb.or([eb("content", "is", null), eb("stage_a_bullet", "is", null)]))
			.execute();

		if (articles.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "extract",
					expected: articles.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const a of articles) {
				queue.add(EXTRACT_ARTICLE_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					articleId: a.id,
				});
			}
		} else {
			await triggerNextStage(db, queue, runId, "extract");
		}
	} else if (completedStage === "extract" || completedStage === "extract-article") {
		// Extract -> Stage A Bullet
		const articles = await db
			.selectFrom("article")
			.selectAll()
			.where("stage_a_bullet", "is", null)
			.execute();

		if (articles.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "stage_a",
					expected: articles.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const a of articles) {
				queue.add(STAGE_A_BULLET_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					articleId: a.id,
				});
			}
		} else {
			await triggerNextStage(db, queue, runId, "stage_a");
		}
	} else if (completedStage === "stage_a" || completedStage === "stage_a_bullet") {
		// Stage A -> Embed
		const unembeddedArticles = await db
			.selectFrom("article as a")
			.leftJoin("article_embedding as ae", "ae.article_id", "a.id")
			.select("a.id as id")
			.where("ae.id", "is", null)
			.execute();

		if (unembeddedArticles.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "embed",
					expected: unembeddedArticles.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const a of unembeddedArticles) {
				queue.add(EMBED_ARTICLE_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					articleId: a.id,
				});
			}
		} else {
			await triggerNextStage(db, queue, runId, "embed");
		}
	} else if (completedStage === "embed" || completedStage === "embed-article") {
		// Embed -> Cluster
		const articleCountRow = await db
			.selectFrom("article")
			.select(db.fn.count<number>("id").as("count"))
			.executeTakeFirst();
		const articleCount = Number(articleCountRow?.count || 0);

		if (articleCount > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "cluster",
					expected: 1,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			queue.add(CLUSTER_RUN_JOB_TYPE, {
				runId,
				stageId: stageRow.id,
			});
		}
	} else if (completedStage === "cluster" || completedStage === "cluster-run") {
		// Cluster -> Score
		const users = await db
			.selectFrom("user")
			.select("id")
			.where("isDisabled", "=", 0)
			.execute();

		if (users.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "score",
					expected: users.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const u of users) {
				queue.add(SCORE_USER_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					userId: u.id,
				});
			}
		}
	} else if (completedStage === "score" || completedStage === "score-user") {
		// Score -> Synthesize
		const selectedClusters = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("run_id", "=", runId)
			.execute();

		if (selectedClusters.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "synthesize",
					expected: selectedClusters.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const sc of selectedClusters) {
				queue.add(SYNTHESIZE_CLUSTER_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					userId: sc.user_id,
					clusterId: sc.cluster_id,
				});
			}
		} else {
			await triggerNextStage(db, queue, runId, "synthesize");
		}
	} else if (completedStage === "synthesize" || completedStage === "synthesize-cluster" || completedStage === "synthesize_cluster") {
		// Synthesize -> Assemble Digest
		const userIds = await db
			.selectFrom("user_selected_cluster")
			.select("user_id")
			.where("run_id", "=", runId)
			.groupBy("user_id")
			.execute();

		if (userIds.length > 0) {
			const stageRow = await db
				.insertInto("run_stage")
				.values({
					run_id: runId,
					stage: "assemble",
					expected: userIds.length,
					completed: 0,
					status: "running",
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			for (const u of userIds) {
				queue.add(ASSEMBLE_DIGEST_JOB_TYPE, {
					runId,
					stageId: stageRow.id,
					userId: u.user_id,
				});
			}
		}
	}
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
	queueArg?: Queue,
): Promise<AdvanceStageResult> {
	let isStageComplete = false;
	let completedStageName = "";
	let runId = 0;
	let isExplicitStage = false;

	const result = await db.transaction().execute(async (trx) => {
		const stage = await trx
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", stageId)
			.executeTakeFirst();

		if (!stage) {
			return { advanced: false, completed: 0, stageStatus: "failed" as StageStatus, reason: "stage_not_found" };
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

		let stats: { completedJobIds?: number[]; isExplicitStage?: boolean } = {};
		try {
			if (run.stats) stats = JSON.parse(run.stats);
		} catch {
			stats = {};
		}

		isExplicitStage = Boolean(stats.isExplicitStage);
		const completedJobIds: number[] = stats.completedJobIds ?? [];

		if (jobId !== undefined && completedJobIds.includes(jobId)) {
			return { advanced: false, completed: stage.completed, stageStatus: stage.status, reason: "duplicate_job" };
		}

		if (jobId !== undefined) {
			completedJobIds.push(jobId);
			stats.completedJobIds = completedJobIds;
		}

		const newCompleted = Math.min(stage.completed + 1, stage.expected);
		isStageComplete = newCompleted >= stage.expected;
		completedStageName = stage.stage;
		runId = stage.run_id;
		const nextStageStatus: StageStatus = isStageComplete ? "complete" : "running";

		await trx
			.updateTable("run_stage")
			.set({
				completed: newCompleted,
				status: nextStageStatus,
			})
			.where("id", "=", stageId)
			.execute();

		await trx
			.updateTable("run")
			.set({
				stats: JSON.stringify(stats),
			})
			.where("id", "=", stage.run_id)
			.execute();

		return {
			advanced: true,
			completed: newCompleted,
			stageStatus: nextStageStatus,
		};
	});

	if (isStageComplete) {
		try {
			const q = await resolveQueue(queueArg);
			if (q && !isExplicitStage) {
				await triggerNextStage(db, q, runId, completedStageName);
			}
		} catch (err) {
			log.error("Failed to trigger next pipeline stage", { runId, completedStageName, error: String(err) });
		}

		// Check if any stage is incomplete
		const remainingIncomplete = await db
			.selectFrom("run_stage")
			.select("id")
			.where("run_id", "=", runId)
			.where("status", "!=", "complete")
			.where("status", "!=", "failed")
			.execute();

		if (remainingIncomplete.length === 0) {
			const now = new Date().toISOString();
			await db
				.updateTable("run")
				.set({
					status: "complete",
					finished_at: now,
				})
				.where("id", "=", runId)
				.execute();
		}
	}

	return result;
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
