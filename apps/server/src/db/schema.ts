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

// ---------------------------------------------------------------------------
// Provider & Source Configuration (M2)
// ---------------------------------------------------------------------------

export interface ProviderConfigTable {
	id: Generated<number>;
	provider: string; // e.g. "brave-news", "openai"
	api_key: string | null;
	enabled: number; // 0 or 1
	config: string | null; // JSON config string
	created_at: string;
	updated_at: string;
}

export type SourceType = "rss" | "brave-news" | "hackernews" | "github-trending" | "scrape";

export interface SourceTable {
	id: Generated<number>;
	type: SourceType;
	name: string;
	url: string | null;
	config: string | null; // JSON specific config (e.g. search query for brave-news)
	enabled: number; // 0 or 1
	owner_user_id: string | null; // NULL = global pool
	created_at: string;
	updated_at: string;
}

export interface ProcessedKeyTable {
	id: Generated<number>;
	identity_key: string; // Unique hash or identifier of content
	source_id: number;
	processed_at: string;
}

export interface ArticleTable {
	id: Generated<number>;
	identity_key: string;
	source_id: number;
	title: string;
	url: string;
	author: string | null;
	content: string | null;
	publish_date: string | null;
	image_url: string | null;
	reading_time_minutes: number | null;
	stage_a_bullet: string | null;
	fetched_at: string;
	created_at: string;
}

export interface Database {
	run: RunTable;
	run_stage: RunStageTable;
	provider_config: ProviderConfigTable;
	source: SourceTable;
	processed_key: ProcessedKeyTable;
	article: ArticleTable;
}
