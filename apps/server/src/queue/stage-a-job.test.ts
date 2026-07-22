import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { STAGE_A_BULLET_JOB_TYPE, type StageABulletJobData } from "./extraction-contracts";
import { processStageABulletJob } from "./stage-a-job";
import { createPlainjobConnection } from "./index";
import { advanceStage, startRun } from "./coordinator";

describe("Stage A Bullet Job Processor", () => {
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

	test("Generates bullet for article and updates article table", async () => {
		// Insert test source and article
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

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "article-1",
				source_id: source.id,
				title: "Breaking Tech News",
				url: "https://example.com/article-1",
				content: "Full content of the breaking tech news article describing new AI developments.",
				stage_a_bullet: null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		expect(article.stage_a_bullet).toBeNull();

		// Start run with stage_a stage
		const startRes = await startRun(db, queue, "manual", { stageName: "stage_a", expectedJobs: 1 });
		expect(startRes.started).toBe(true);

		if (!startRes.started) return;

		const jobData: StageABulletJobData = {
			runId: startRes.runId,
			stageId: startRes.stageId,
			articleId: article.id,
		};

		const job = {
			id: 1,
			type: STAGE_A_BULLET_JOB_TYPE,
			data: jobData,
			status: "pending",
		} as any;

		// Process job
		await processStageABulletJob(db, queue, job);

		// Verify article updated
		const updatedArticle = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", article.id)
			.executeTakeFirstOrThrow();

		expect(updatedArticle.stage_a_bullet).not.toBeNull();
		expect(typeof updatedArticle.stage_a_bullet).toBe("string");
		expect(updatedArticle.stage_a_bullet!.length).toBeGreaterThan(0);

		// Verify llm_usage recorded 1 completion call
		const usageRecords = await db.selectFrom("llm_usage").selectAll().execute();
		expect(usageRecords.length).toBe(1);
		expect(usageRecords[0].task_name).toBe("stage_a_bullet");
	});

	test("Re-run reuses existing stage_a_bullet without re-calling LLM", async () => {
		// Insert test source and article with pre-existing stage_a_bullet
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

		const existingBullet = "Pre-existing summary bullet for article";

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "article-2",
				source_id: source.id,
				title: "Existing Article",
				url: "https://example.com/article-2",
				content: "Content for article 2.",
				stage_a_bullet: existingBullet,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		// Start run
		const startRes = await startRun(db, queue, "manual", { stageName: "stage_a", expectedJobs: 1 });
		expect(startRes.started).toBe(true);

		if (!startRes.started) return;

		const jobData: StageABulletJobData = {
			runId: startRes.runId,
			stageId: startRes.stageId,
			articleId: article.id,
		};

		const job = {
			id: 2,
			type: STAGE_A_BULLET_JOB_TYPE,
			data: jobData,
			status: "pending",
		} as any;

		// Process job on article that already has bullet
		await processStageABulletJob(db, queue, job);

		// Verify stage_a_bullet remains untouched
		const updatedArticle = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", article.id)
			.executeTakeFirstOrThrow();

		expect(updatedArticle.stage_a_bullet).toBe(existingBullet);

		// Verify NO LLM completion was recorded in llm_usage
		const usageRecords = await db.selectFrom("llm_usage").selectAll().execute();
		expect(usageRecords.length).toBe(0);
	});
});
