import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { ASSEMBLE_DIGEST_JOB_TYPE, type AssembleDigestJobData } from "../queue/synthesis-contracts";
import { parseDigestResult, processAssembleDigestJob } from "./assemble-digest";

describe("Stage C Assemble Digest Worker", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({
				choices: [{ message: { content: JSON.stringify({ executive_summary: "Test executive summary.", key_takeaways: [], why_it_matters: "Test significance.", key_quotes: [] }) } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}))) as unknown as typeof fetch;
		await db.insertInto("provider_config").values({ provider: "test-llm", api_key: "test-key", enabled: 1, config: JSON.stringify({ baseUrl: "https://test.invalid/v1" }) }).execute();
		await db.insertInto("task_model").values({ task_name: "stage_c_assembly", provider: "test-llm", model_name: "test-model" }).execute();
	});

	afterEach(async () => {
		await db.destroy();
		sqlite.close();
	});

	describe("parseDigestResult", () => {
		test("parses valid JSON response", () => {
			const json = JSON.stringify({
				executive_summary: "Exec Summary Test",
				key_takeaways: ["Takeaway 1", "Takeaway 2"],
				why_it_matters: "Why it matters test",
				key_quotes: [{ quote: "Sample quote", citation: "art_1" }],
			});

			const res = parseDigestResult(json);
			expect(res.executive_summary).toBe("Exec Summary Test");
			expect(res.key_takeaways).toEqual(["Takeaway 1", "Takeaway 2"]);
			expect(res.why_it_matters).toBe("Why it matters test");
			expect(res.key_quotes).toEqual([{ quote: "Sample quote", citation: "art_1" }]);
		});

		test("strips markdown code blocks before parsing", () => {
			const raw = "```json\n" + JSON.stringify({
				executive_summary: "Markdown Summary",
				key_takeaways: ["Item 1"],
				why_it_matters: "Important",
				key_quotes: [],
			}) + "\n```";

			const res = parseDigestResult(raw);
			expect(res.executive_summary).toBe("Markdown Summary");
			expect(res.key_takeaways).toEqual(["Item 1"]);
			expect(res.why_it_matters).toBe("Important");
		});

		test("returns fallback object when text is not valid JSON", () => {
			const plainText = "Plain text completion output";
			const res = parseDigestResult(plainText);
			expect(res.executive_summary).toBe(plainText);
			expect(res.key_takeaways).toEqual([]);
			expect(res.why_it_matters).toBe("Key developments matching your specified interest profile.");
			expect(res.key_quotes).toEqual([]);
		});
	});

	describe("processAssembleDigestJob", () => {
		test("fetches digest clusters, calls LLM, and updates digest row", async () => {
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

			const stage = await db
				.insertInto("run_stage")
				.values({
					run_id: run.id,
					stage: "stage_c",
					expected: 1,
					completed: 0,
					status: "running",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const userId = "user-test-123";

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "",
					key_takeaways: "[]",
					why_it_matters: "",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const source = await db
				.insertInto("source")
				.values({
					type: "rss",
					name: "News Source",
					url: "https://example.com/rss",
					enabled: 1,
					owner_user_id: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const article = await db
				.insertInto("article")
				.values({
					identity_key: "art-10",
					source_id: source.id,
					title: "AI Breakthrough Announced",
					url: "https://example.com/ai-breakthrough",
					content: "A major AI breakthrough was announced today with performance gains.",
					stage_a_bullet: "Major AI breakthrough announced with high gains.",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const cluster = await db
				.insertInto("cluster")
				.values({
					run_id: run.id,
					primary_article_id: article.id,
					summary_title: "AI Breakthrough",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digestCluster = await db
				.insertInto("digest_cluster")
				.values({
					digest_id: digest.id,
					cluster_id: cluster.id,
					title: "Major AI Breakthrough",
					summary: "New AI model sets benchmarks across standard tests.",
					perspectives: JSON.stringify(["Consensus on efficiency gains", "Concerns on open weights"]),
					timeline: JSON.stringify(["July 2026: Benchmark released"]),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			await db
				.insertInto("citation")
				.values({
					digest_id: digest.id,
					digest_cluster_id: digestCluster.id,
					article_id: article.id,
					citation_key: "art_10",
				})
				.execute();

			const jobData: AssembleDigestJobData = {
				runId: run.id,
				stageId: stage.id,
				userId,
			};

			const job = {
				id: 99,
				type: ASSEMBLE_DIGEST_JOB_TYPE,
				data: jobData,
				status: "pending",
			} as any;

			await processAssembleDigestJob(db, job);

			const updatedDigest = await db
				.selectFrom("digest")
				.selectAll()
				.where("id", "=", digest.id)
				.executeTakeFirstOrThrow();

			expect(updatedDigest.executive_summary).not.toBe("");
			expect(updatedDigest.key_takeaways).not.toBe("");
			expect(JSON.parse(updatedDigest.key_takeaways)).toBeArray();

			const llmLogs = await db
				.selectFrom("llm_usage")
				.selectAll()
				.where("task_name", "=", "stage_c_assembly")
				.execute();

			expect(llmLogs.length).toBe(1);
			expect(llmLogs[0].run_id).toBe(run.id);

			const updatedStage = await db
				.selectFrom("run_stage")
				.selectAll()
				.where("id", "=", stage.id)
				.executeTakeFirstOrThrow();

			expect(updatedStage.completed).toBe(1);
			expect(updatedStage.status).toBe("complete");
		});

		test("fails the stage when digest clusters are missing", async () => {
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

			const stage = await db
				.insertInto("run_stage")
				.values({
					run_id: run.id,
					stage: "stage_c",
					expected: 1,
					completed: 0,
					status: "running",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const jobData: AssembleDigestJobData = {
				runId: run.id,
				stageId: stage.id,
				userId: "non-existent-user",
			};

			const job = {
				id: 100,
				type: ASSEMBLE_DIGEST_JOB_TYPE,
				data: jobData,
				status: "pending",
			} as any;

			await expect(processAssembleDigestJob(db, job)).rejects.toThrow("No digest clusters found");

			const updatedStage = await db
				.selectFrom("run_stage")
				.selectAll()
				.where("id", "=", stage.id)
				.executeTakeFirstOrThrow();

			expect(updatedStage.completed).toBe(0);
			expect(updatedStage.status).toBe("failed");

			const updatedRun = await db
				.selectFrom("run")
				.selectAll()
				.where("id", "=", run.id)
				.executeTakeFirstOrThrow();
			expect(updatedRun.status).toBe("failed");
		});
	});
});
