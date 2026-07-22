import type { Generated } from "kysely";

// Kysely schema for app-owned tables. BetterAuth and plainjob create and manage
// their OWN tables on the same connection — they are intentionally NOT modeled
// here. Keep this file organized by concern; later milestones extend it with
// pipeline tables (article, cluster, digest, ...).

// ---------------------------------------------------------------------------
// Run coordination (M1) — a single run fans out into many fine-grained jobs;
// per-stage counters detect "stage N complete → enqueue stage N+1".
// ---------------------------------------------------------------------------

export type RunTrigger = "cron" | "manual";
export type RunStatus = "running" | "complete" | "failed";
export type StageStatus = "pending" | "running" | "complete" | "failed";

export interface RunTable {
	id: Generated<number>;
	trigger: RunTrigger;
	status: RunStatus;
	started_at: string;
	finished_at: string | null;
	/** JSON blob of per-run stats (per-source counts, etc.). */
	stats: string | null;
}

export interface RunStageTable {
	id: Generated<number>;
	run_id: number;
	stage: string;
	expected: number;
	completed: number;
	status: StageStatus;
}

export interface Database {
	run: RunTable;
	run_stage: RunStageTable;
}
