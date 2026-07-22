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

// ---------------------------------------------------------------------------
// LLM & Task Model Configuration (M3)
// ---------------------------------------------------------------------------

export interface TaskModelTable {
	id: Generated<number>;
	task_name: string; // e.g. "stage_a_bullet", "stage_b_synthesis"
	provider: string; // e.g. "openai", "anthropic", "faux"
	model_name: string; // e.g. "gpt-4o-mini", "faux-cheap"
	created_at: string;
	updated_at: string;
}

export interface LlmUsageTable {
	id: Generated<number>;
	run_id: number | null;
	task_name: string;
	provider: string;
	model_name: string;
	prompt_tokens: number;
	completion_tokens: number;
	estimated_cost: number;
	created_at: string;
}

// ---------------------------------------------------------------------------
// Embeddings, Clustering & Interest Profiles (M4)
// ---------------------------------------------------------------------------

export interface ArticleEmbeddingTable {
	id: Generated<number>;
	article_id: number;
	embedding: Uint8Array; // Float32Array serialized as Uint8Array bytes
	model_name: string;
	created_at: string;
}

export interface ClusterTable {
	id: Generated<number>;
	run_id: number;
	primary_article_id: number;
	summary_title: string | null;
	created_at: string;
}

export interface ClusterArticleTable {
	id: Generated<number>;
	cluster_id: number;
	article_id: number;
	is_primary: number; // 1 = primary, 0 = syndication/related
	created_at: string;
}

export interface InterestProfileTable {
	id: Generated<number>;
	user_id: string; // foreign key to BetterAuth user
	name: string;
	keywords: string; // JSON array string
	topics: string; // JSON array string
	entities: string; // JSON array string
	include_rules: string; // JSON array string
	exclude_rules: string; // JSON array string
	profile_embedding: Uint8Array | null;
	similarity_threshold: number;
	max_cluster_cap: number;
	ntfy_topic: string | null;
	created_at: string;
	updated_at: string;
}

export interface UserSelectedClusterTable {
	id: Generated<number>;
	run_id: number;
	user_id: string;
	cluster_id: number;
	score: number;
	reason: string | null;
	created_at: string;
}

export interface Database {
	run: RunTable;
	run_stage: RunStageTable;
	provider_config: ProviderConfigTable;
	source: SourceTable;
	processed_key: ProcessedKeyTable;
	article: ArticleTable;
	task_model: TaskModelTable;
	llm_usage: LlmUsageTable;
	article_embedding: ArticleEmbeddingTable;
	cluster: ClusterTable;
	cluster_article: ClusterArticleTable;
	interest_profile: InterestProfileTable;
	user_selected_cluster: UserSelectedClusterTable;
}
