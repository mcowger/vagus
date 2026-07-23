import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { serializeFloat32 } from "../embeddings/types";
import { scoreClustersForUser } from "./index";
import { SCORE_USER_JOB_TYPE, type ScoreUserJobData } from "../queue/clustering-contracts";
import { processScoreUserJob } from "../queue/score-job";
import { createPlainjobConnection } from "../queue/index";
import { startRun } from "../queue/coordinator";

describe("Scoring Module & Score User Job", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;
	let queue: Queue;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
		});
	});

	afterEach(async () => {
		queue.close();
		await db.destroy();
		sqlite.close();
	});

	async function setupTestRunAndArticles() {
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Test Source",
				url: "https://example.com/rss",
				enabled: 1,
				owner_user_id: null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const run = await db
			.insertInto("run")
			.values({
				trigger: "manual",
				status: "running",
				started_at: new Date().toISOString(),
				finished_at: null,
				stats: null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article1 = await db
			.insertInto("article")
			.values({
				identity_key: "art-1",
				source_id: source.id,
				title: "TypeScript 5.0 Released with New Features",
				url: "https://example.com/1",
				content: "TypeScript and JavaScript language updates for developers.",
				stage_a_bullet: "TypeScript release notes",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article2 = await db
			.insertInto("article")
			.values({
				identity_key: "art-2",
				source_id: source.id,
				title: "Cooking Spaghetti Carbonara Recipe",
				url: "https://example.com/2",
				content: "Delicious pasta recipe using eggs and bacon.",
				stage_a_bullet: "Pasta recipe",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const cluster1 = await db
			.insertInto("cluster")
			.values({
				run_id: run.id,
				primary_article_id: article1.id,
				summary_title: "TypeScript Release",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const cluster2 = await db
			.insertInto("cluster")
			.values({
				run_id: run.id,
				primary_article_id: article2.id,
				summary_title: "Pasta Cooking",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return { run, source, article1, article2, cluster1, cluster2 };
	}

	test("Calculates fallback title keyword overlap when embeddings are missing", async () => {
		const { run, cluster1, cluster2 } = await setupTestRunAndArticles();

		// Create interest profile with keywords matching article 1
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-1",
				name: "Tech Profile",
				keywords: JSON.stringify(["TypeScript", "JavaScript"]),
				topics: JSON.stringify(["Programming"]),
				entities: JSON.stringify(["Microsoft"]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.5,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-1");

		// Cluster 1 title "TypeScript 5.0 Released with New Features" matches keyword "TypeScript" (1 of 2 => base score 0.5)
		// Boost for "TypeScript" (+0.1 => prelim score 0.6)
		// Borderline score triggers tiebreaker
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].clusterId).toBe(cluster1.id);
		expect(results[0].score).toBeGreaterThan(0);

		// Verify user_selected_cluster table has entries
		const selected = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("run_id", "=", run.id)
			.where("user_id", "=", "user-1")
			.execute();

		expect(selected.length).toBe(results.length);
		expect(selected[0].cluster_id).toBe(cluster1.id);
	});

	test("Calculates base score using cosine similarity when embeddings exist", async () => {
		const { run, article1, cluster1 } = await setupTestRunAndArticles();

		// Insert article embedding [1, 0, 0]
		const vec1 = new Float32Array([1.0, 0.0, 0.0]);
		await db
			.insertInto("article_embedding")
			.values({
				article_id: article1.id,
				embedding: serializeFloat32(vec1),
				model_name: "test-model",
			})
			.execute();

		// Insert profile with profile_embedding [1, 0, 0] (cosine similarity = 1.0)
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-vec",
				name: "Vec Profile",
				keywords: JSON.stringify([]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: serializeFloat32(vec1),
				similarity_threshold: 0.5,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-vec");

		expect(results.length).toBe(1);
		expect(results[0].clusterId).toBe(cluster1.id);
		expect(results[0].score).toBe(1.0);
	});

	test("Applies keyword and entity boost (+0.1 each)", async () => {
		const { run, cluster1 } = await setupTestRunAndArticles();

		// Profile matching both keyword 'TypeScript' and entity 'JavaScript' in full text
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-boost",
				name: "Boost Profile",
				keywords: JSON.stringify(["TypeScript"]),
				entities: JSON.stringify(["JavaScript"]),
				topics: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-boost");

		const c1Result = results.find((r) => r.clusterId === cluster1.id);
		expect(c1Result).toBeDefined();
		// Base score for title "TypeScript 5.0..." matching 1/1 term = 1.0
		// Boost: TypeScript (+0.1), JavaScript (+0.1) => 1.2 capped at 1.0
		expect(c1Result!.score).toBe(1.0);
		expect(c1Result!.reason).toContain("Boost: +0.20");
	});

	test("Enforces hard include rules (score = 0 when none match)", async () => {
		const { run } = await setupTestRunAndArticles();

		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-include",
				name: "Include Profile",
				keywords: JSON.stringify(["TypeScript"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify(["Quantum Computing"]), // Non-existent rule
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-include");

		// All clusters fail include rules -> none selected in top clusters with score > 0
		expect(results.length).toBe(0);

		const selectedInDb = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("run_id", "=", run.id)
			.where("user_id", "=", "user-include")
			.execute();

		expect(selectedInDb.length).toBe(0);
	});

	test("Enforces hard exclude rules (score = 0 when any match)", async () => {
		const { run } = await setupTestRunAndArticles();

		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-exclude",
				name: "Exclude Profile",
				keywords: JSON.stringify(["TypeScript", "Spaghetti"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify(["TypeScript", "Spaghetti"]), // Exclude all articles
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-exclude");

		expect(results.length).toBe(0);
	});

	test("Triggers LLM tiebreaker for borderline scores (0.5 to 0.7)", async () => {
		const { run, cluster1 } = await setupTestRunAndArticles();

		// Base score = 0.5 (1 of 2 keywords match in title) + no boosts => 0.5 (borderline 0.5-0.7)
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-tiebreaker",
				name: "Tiebreaker Profile",
				keywords: JSON.stringify(["TypeScript", "NonexistentKeyword"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 5,
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-tiebreaker");

		const c1Result = results.find((r) => r.clusterId === cluster1.id);
		expect(c1Result).toBeDefined();
		expect(c1Result!.reason).toContain("LLM tiebreaker");

		// Check that llm_usage recorded the scoring_tiebreaker call
		const llmLogs = await db
			.selectFrom("llm_usage")
			.selectAll()
			.where("task_name", "=", "scoring_tiebreaker")
			.execute();

		expect(llmLogs.length).toBe(1);
	});

	test("Caps selected clusters to max_cluster_cap", async () => {
		const { run } = await setupTestRunAndArticles();

		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-capped",
				name: "Capped Profile",
				keywords: JSON.stringify(["TypeScript", "Spaghetti"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 1, // Cap to 1
			})
			.execute();

		const results = await scoreClustersForUser(db, run.id, "user-capped");

		expect(results.length).toBe(1);
	});

	test("processScoreUserJob executes and advances run stage", async () => {
		const { run } = await setupTestRunAndArticles();

		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-job",
				name: "Job Profile",
				keywords: JSON.stringify(["TypeScript"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: null,
				similarity_threshold: 0.1,
				max_cluster_cap: 5,
			})
			.execute();

		const stage = await db
			.insertInto("run_stage")
			.values({
				run_id: run.id,
				stage: "score",
				expected: 1,
				completed: 0,
				status: "running",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const jobData: ScoreUserJobData = {
			runId: run.id,
			stageId: stage.id,
			userId: "user-job",
		};

		const job = {
			id: 10,
			type: SCORE_USER_JOB_TYPE,
			data: jobData,
			status: "pending",
		} as any;

		await processScoreUserJob(db, job);

		// Verify selected clusters saved
		const selected = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("run_id", "=", run.id)
			.where("user_id", "=", "user-job")
			.execute();

		expect(selected.length).toBeGreaterThan(0);

		// Verify stage was advanced
		const updatedStage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", stage.id)
			.executeTakeFirstOrThrow();

		expect(updatedStage.completed).toBe(1);
		expect(updatedStage.status).toBe("complete");
	});

	test("skips clusters whose articles were already delivered in a prior digest for the user", async () => {
		const { run, article1, cluster1 } = await setupTestRunAndArticles();
		const userId = "user-dedup";
		const now = new Date().toISOString();

		// Link cluster1 to article1 in cluster_article table
		await db
			.insertInto("cluster_article")
			.values({ cluster_id: cluster1.id, article_id: article1.id, is_primary: 1, created_at: now })
			.execute();

		// Create interest profile matching article1
		await db
			.insertInto("interest_profile")
			.values({
				user_id: userId,
				name: "Dev Profile",
				keywords: JSON.stringify(["TypeScript"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				similarity_threshold: 0.5,
				max_cluster_cap: 10,
				created_at: now,
				updated_at: now,
			})
			.execute();

		// Score run 1
		const run1Scores = await scoreClustersForUser(db, run.id, userId);
		expect(run1Scores.length).toBeGreaterThan(0);
		expect(run1Scores[0].clusterId).toBe(cluster1.id);

		// Simulate Digest #1 creation containing article1
		const digest = await db
			.insertInto("digest")
			.values({
				user_id: userId,
				run_id: run.id,
				executive_summary: "Digest 1",
				why_it_matters: "Test",
				created_at: now,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		await db
			.insertInto("citation")
			.values({
				digest_id: digest.id,
				article_id: article1.id,
				citation_key: `art_${article1.id}`,
			})
			.execute();

		// Create run 2 with the same cluster and articles
		const run2 = await db
			.insertInto("run")
			.values({ trigger: "manual", status: "running", started_at: now })
			.returningAll()
			.executeTakeFirstOrThrow();

		const clusterRun2 = await db
			.insertInto("cluster")
			.values({ run_id: run2.id, primary_article_id: article1.id, created_at: now })
			.returningAll()
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: clusterRun2.id, article_id: article1.id, is_primary: 1, created_at: now })
			.execute();

		// Score run 2 for user - cluster containing article1 should now be skipped as already delivered
		const run2Scores = await scoreClustersForUser(db, run2.id, userId);
		const clusterRun2Result = run2Scores.find((s) => s.clusterId === clusterRun2.id);

		expect(clusterRun2Result).toBeUndefined();
	});

	test("suppresses digest creation when qualified cluster count is below min_cluster_count threshold", async () => {
		const { run, article1, cluster1 } = await setupTestRunAndArticles();
		const userId = "user-min-count";
		const now = new Date().toISOString();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: cluster1.id, article_id: article1.id, is_primary: 1, created_at: now })
			.execute();

		// Create interest profile requiring minimum 5 clusters
		await db
			.insertInto("interest_profile")
			.values({
				user_id: userId,
				name: "Strict Profile",
				keywords: JSON.stringify(["TypeScript"]),
				topics: JSON.stringify([]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				similarity_threshold: 0.5,
				max_cluster_cap: 10,
				min_cluster_count: 5,
				created_at: now,
				updated_at: now,
			})
			.execute();

		// Score run 1 (which only has 1 cluster matching)
		const scores = await scoreClustersForUser(db, run.id, userId);

		// Digest creation is suppressed because 1 qualified cluster < 5 required min clusters
		expect(scores.length).toBe(0);
	});
});
