import type { Generated } from "kysely";

export type Timestamp = Generated<string>;

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
	started_at: Timestamp;
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
	created_at: Timestamp;
	updated_at: Timestamp;
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
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ProcessedKeyTable {
	id: Generated<number>;
	identity_key: string; // Unique hash or identifier of content
	source_id: number;
	processed_at: Timestamp;
}

export interface ArticleTable {
	id: Generated<number>;
	run_id: number | null;
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
	fetched_at: Timestamp;
	created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// LLM & Task Model Configuration (M3)
// ---------------------------------------------------------------------------

export interface TaskModelTable {
	id: Generated<number>;
	task_name: string; // e.g. "stage_a_bullet", "stage_b_synthesis"
	provider: string; // e.g. "openai", "anthropic"
	model_name: string; // e.g. "gpt-4o-mini"
	created_at: Timestamp;
	updated_at: Timestamp;
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
	created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Embeddings, Clustering & Interest Profiles (M4)
// ---------------------------------------------------------------------------

export interface ArticleEmbeddingTable {
	id: Generated<number>;
	article_id: number;
	embedding: Uint8Array; // Float32Array serialized as Uint8Array bytes
	model_name: string;
	created_at: Timestamp;
}

export interface ClusterTable {
	id: Generated<number>;
	run_id: number;
	primary_article_id: number;
	summary_title: string | null;
	created_at: Timestamp;
}

export interface ClusterArticleTable {
	id: Generated<number>;
	cluster_id: number;
	article_id: number;
	is_primary: number; // 1 = primary, 0 = syndication/related
	created_at: Timestamp;
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
	positive_embedding: Uint8Array | null;
	negative_embedding: Uint8Array | null;
	similarity_threshold: number;
	max_cluster_cap: number;
	min_cluster_count: Generated<number>; // min clusters required to trigger digest
	max_digests_per_day: number | null; // max rate per 24 hours
	target_delivery_time: string | null; // preferred target delivery time e.g. "09:00"
	ntfy_topic: string | null;
	is_default: Generated<number>; // 1 = default profile
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface UserFeedbackTable {
	id: Generated<number>;
	user_id: string;
	target_type: "source" | "cluster";
	target_id: string;
	vote: number; // 1 = thumbs_up, -1 = thumbs_down, 0 = neutral
	topic_category: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface UserSourceWeightTable {
	id: Generated<number>;
	user_id: string;
	source_id: number;
	weight: number; // 0.0 to 2.0 multiplier
	updated_at: Timestamp;
}

export interface UserSelectedClusterTable {
	id: Generated<number>;
	run_id: number;
	user_id: string;
	profile_id: number | null;
	cluster_id: number;
	score: number;
	reason: string | null;
	created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Synthesis, Digests & Citations (M5)
// ---------------------------------------------------------------------------

export interface DigestTable {
	id: Generated<number>;
	run_id: number;
	user_id: string;
	profile_id: number | null;
	executive_summary: string;
	key_takeaways: Generated<string>; // JSON array string
	why_it_matters: string;
	key_quotes: Generated<string>; // JSON array string of { quote, citation }
	created_at: Timestamp;
}

export interface DigestClusterTable {
	id: Generated<number>;
	digest_id: number;
	cluster_id: number;
	title: string;
	summary: string;
	perspectives: Generated<string>; // JSON array string
	timeline: Generated<string>; // JSON array string
	created_at: Timestamp;
}

export interface CitationTable {
	id: Generated<number>;
	digest_id: number;
	digest_cluster_id: number | null;
	article_id: number;
	citation_key: string; // e.g. "art_10"
	created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Scheduling, Notifications & System Settings (M6)
// ---------------------------------------------------------------------------

export interface SystemSettingTable {
	key: string; // Primary key e.g. "article_retention_days", "ntfy_base_url"
	value: string;
	updated_at: Timestamp;
}

export interface NotificationLogTable {
	id: Generated<number>;
	user_id: string;
	digest_id: number;
	topic: string;
	status: "sent" | "failed";
	error: string | null;
	sent_at: Timestamp;
}

export interface UserTable {
	id: string;
	name: string;
	email: string;
	role: string;
	isDisabled: number;
}

export interface Database {
	user: UserTable;
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
	digest: DigestTable;
	digest_cluster: DigestClusterTable;
	citation: CitationTable;
	system_setting: SystemSettingTable;
	notification_log: NotificationLogTable;
	user_feedback: UserFeedbackTable;
	user_source_weight: UserSourceWeightTable;
}
