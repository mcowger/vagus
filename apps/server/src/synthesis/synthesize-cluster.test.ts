import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import { migrateToLatest } from "../db/migrate";
import type { Database } from "../db/schema";
import { FakeEmbedder } from "../embeddings/fake";
import { createPlainjobConnection } from "../queue/index";
import { advanceStage, startRun } from "../queue/coordinator";
import { SYNTHESIZE_CLUSTER_JOB_TYPE, type SynthesizeClusterJobData } from "../queue/synthesis-contracts";
import { parseClusterSummaryResponse, processSynthesizeClusterJob } from "./synthesize-cluster";
import { validateAndFilterCitations } from "./types";

describe("Synthesize Cluster Worker", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;
	let queue: Queue;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({
				choices: [{ message: { content: JSON.stringify({ title: "Test summary", summary: "Test cluster summary.", perspectives: [], timeline: [], citations: [] }) } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}))) as unknown as typeof fetch;
		await db.insertInto("provider_config").values({ provider: "test-llm", api_key: "test-key", enabled: 1, config: JSON.stringify({ baseUrl: "https://test.invalid/v1" }) }).execute();
		await db.insertInto("task_model").values({ task_name: "stage_b_synthesis", provider: "test-llm", model_name: "test-model" }).execute();

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
		});
	});

	afterEach(async () => {
		queue.close();
		await db.destroy();
		sqlite.close();
	});

	test("parseClusterSummaryResponse parses JSON and tool call formats cleanly", () => {
		const validKeys = new Set(["art_10", "art_11"]);

		// Standard JSON
		const jsonInput = JSON.stringify({
			title: "AI Breakthrough",
			summary: "New model achieves SOTA performance across benchmarks.",
			perspectives: ["Industry leaders praised the speed.", "Critics raised safety concerns."],
			timeline: ["2026-07-01: Paper released", "2026-07-05: Demo launch"],
			citations: ["art_10", "art_11", "art_999"],
		});

		const res1 = parseClusterSummaryResponse(jsonInput, validKeys, "Fallback Title");
		expect(res1.title).toBe("AI Breakthrough");
		expect(res1.summary).toBe("New model achieves SOTA performance across benchmarks.");
		expect(res1.perspectives.length).toBe(2);
		expect(res1.timeline.length).toBe(2);
		expect(res1.citations.length).toBe(3);

		// Citation validation on output
		const filteredCitations = validateAndFilterCitations(res1.citations, validKeys);
		expect(filteredCitations).toEqual(["art_10", "art_11"]);

		// Codeblock JSON
		const codeblockInput = "```json\n" + jsonInput + "\n```";
		const res2 = parseClusterSummaryResponse(codeblockInput, validKeys, "Fallback Title");
		expect(res2.title).toBe("AI Breakthrough");

		// Tool call format
		const toolCallInput = `submit_cluster_summary(${jsonInput})`;
		const res3 = parseClusterSummaryResponse(toolCallInput, validKeys, "Fallback Title");
		expect(res3.title).toBe("AI Breakthrough");
	});

	test("processSynthesizeClusterJob processes cluster and inserts digest, digest_cluster, and citations", async () => {
		// Use FakeEmbedder to generate embeddings for articles
		const embedder = new FakeEmbedder(128);

		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Tech Feed",
				url: "https://example.com/rss",
				enabled: 1,
				owner_user_id: null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article1 = await db
			.insertInto("article")
			.values({
				identity_key: "art-1",
				source_id: source.id,
				title: "Major Quantum Computing Advance Announced",
				url: "https://example.com/art-1",
				content: "Researchers demonstrate fault-tolerant quantum error correction.",
				stage_a_bullet: "Quantum error correction milestone achieved by research group.",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article2 = await db
			.insertInto("article")
			.values({
				identity_key: "art-2",
				source_id: source.id,
				title: "Quantum Breakthrough Shakes Tech Industry",
				url: "https://example.com/art-2",
				content: "Industry leaders react to quantum computing error correction news.",
				stage_a_bullet: "Industry reactions highlight potential impact on cryptography.",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		// Generate embeddings with FakeEmbedder
		const vec1 = await embedder.embedText(article1.title + " " + article1.content);
		const vec2 = await embedder.embedText(article2.title + " " + article2.content);
		expect(vec1.length).toBe(128);
		expect(vec2.length).toBe(128);

		const userId = "user_test_123";

		// Start run
		const startRes = await startRun(db, queue, "manual", {
			stageName: "synthesize_cluster",
			expectedJobs: 1,
		});
		expect(startRes.started).toBe(true);
		if (!startRes.started) return;

		const runId = startRes.runId;

		// Create cluster and cluster_article rows
		const cluster = await db
			.insertInto("cluster")
			.values({
				run_id: runId,
				primary_article_id: article1.id,
				summary_title: "Quantum Computing Advancement",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values([
				{ cluster_id: cluster.id, article_id: article1.id, is_primary: 1 },
				{ cluster_id: cluster.id, article_id: article2.id, is_primary: 0 },
			])
			.execute();

		const jobData: SynthesizeClusterJobData = {
			runId,
			stageId: startRes.stageId,
			userId,
			clusterId: cluster.id,
		};

		const job = {
			id: 101,
			type: SYNTHESIZE_CLUSTER_JOB_TYPE,
			data: jobData,
			status: "pending",
		} as any;

		// Execute synthesize cluster job
		await processSynthesizeClusterJob(db, queue, job);

		// Verify digest created
		const digest = await db
			.selectFrom("digest")
			.selectAll()
			.where("run_id", "=", runId)
			.where("user_id", "=", userId)
			.executeTakeFirst();

		expect(digest).toBeDefined();
		expect(digest!.run_id).toBe(runId);
		expect(digest!.user_id).toBe(userId);

		// Verify digest_cluster created
		const digestCluster = await db
			.selectFrom("digest_cluster")
			.selectAll()
			.where("digest_id", "=", digest!.id)
			.where("cluster_id", "=", cluster.id)
			.executeTakeFirst();

		expect(digestCluster).toBeDefined();
		expect(digestCluster!.title.length).toBeGreaterThan(0);
		expect(digestCluster!.summary.length).toBeGreaterThan(0);

		const perspectives = JSON.parse(digestCluster!.perspectives);
		const timeline = JSON.parse(digestCluster!.timeline);
		expect(Array.isArray(perspectives)).toBe(true);
		expect(Array.isArray(timeline)).toBe(true);

		// Verify citations created with stable keys art_<article.id>
		const citations = await db
			.selectFrom("citation")
			.selectAll()
			.where("digest_id", "=", digest!.id)
			.where("digest_cluster_id", "=", digestCluster!.id)
			.execute();

		expect(citations.length).toBeGreaterThan(0);
		for (const citation of citations) {
			expect(citation.citation_key).toBe(`art_${citation.article_id}`);
			expect([article1.id, article2.id]).toContain(citation.article_id);
		}

		// Verify LLM usage recorded for stage_b_synthesis
		const usage = await db
			.selectFrom("llm_usage")
			.selectAll()
			.where("task_name", "=", "stage_b_synthesis")
			.execute();

		expect(usage.length).toBe(1);
		expect(usage[0].provider).toBe("test-llm");

		// Verify stage completed
		const stage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", startRes.stageId)
			.executeTakeFirstOrThrow();

		expect(stage.status).toBe("complete");
	});

	test("processSynthesizeClusterJob filters out hallucinated citation keys", async () => {
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Tech Feed",
				url: "https://example.com/rss",
				enabled: 1,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "art-single",
				source_id: source.id,
				title: "Single Article Event",
				url: "https://example.com/single",
				content: "Single article content.",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const startRes = await startRun(db, queue, "manual", {
			stageName: "synthesize_cluster",
			expectedJobs: 1,
		});
		expect(startRes.started).toBe(true);
		if (!startRes.started) return;

		const cluster = await db
			.insertInto("cluster")
			.values({
				run_id: startRes.runId,
				primary_article_id: article.id,
				summary_title: "Single Article Cluster",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: cluster.id, article_id: article.id, is_primary: 1 })
			.execute();

		const userId = "user_citation_test";

		const jobData: SynthesizeClusterJobData = {
			runId: startRes.runId,
			stageId: startRes.stageId,
			userId,
			clusterId: cluster.id,
		};

		const job = {
			id: 202,
			type: SYNTHESIZE_CLUSTER_JOB_TYPE,
			data: jobData,
			status: "pending",
		} as any;

		await processSynthesizeClusterJob(db, queue, job);

		const digest = await db
			.selectFrom("digest")
			.selectAll()
			.where("run_id", "=", startRes.runId)
			.where("user_id", "=", userId)
			.executeTakeFirstOrThrow();

		const citations = await db
			.selectFrom("citation")
			.selectAll()
			.where("digest_id", "=", digest.id)
			.execute();

		expect(citations.length).toBe(1);
		expect(citations[0].citation_key).toBe(`art_${article.id}`);
		expect(citations[0].article_id).toBe(article.id);
	});
});
