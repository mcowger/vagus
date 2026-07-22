import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { FakeEmbedder } from "../embeddings/fake";
import { OpenAiEmbedder } from "../embeddings/openai";
import { deserializeFloat32, serializeFloat32 } from "../embeddings/types";
import { EMBED_ARTICLE_JOB_TYPE, type EmbedArticleJobData } from "./clustering-contracts";
import { processEmbedArticleJob } from "./embed-job";
import { createPlainjobConnection } from "./index";
import { startRun } from "./coordinator";

describe("Embed Article Job Processor", () => {
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

	test("generates embedding for article and updates article_embedding table", async () => {
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Test Source",
				url: "https://example.com/rss",
				enabled: 1,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "embed-art-1",
				source_id: source.id,
				title: "AI Breakthrough Announcement",
				url: "https://example.com/art-1",
				content: "Full text content regarding the AI breakthrough.",
				stage_a_bullet: "Key bullet point summarizing AI breakthrough.",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const startRes = await startRun(db, queue, "manual", { stageName: "embed", expectedJobs: 1 });
		expect(startRes.started).toBe(true);
		if (!startRes.started) return;

		const jobData: EmbedArticleJobData = {
			runId: startRes.runId,
			stageId: startRes.stageId,
			articleId: article.id,
		};

		const job = {
			id: 10,
			type: EMBED_ARTICLE_JOB_TYPE,
			data: jobData,
		} as any;

		const fakeEmbedder = new FakeEmbedder(128);
		await processEmbedArticleJob(db, job, fakeEmbedder);

		const embeddingRow = await db
			.selectFrom("article_embedding")
			.selectAll()
			.where("article_id", "=", article.id)
			.executeTakeFirstOrThrow();

		expect(embeddingRow.article_id).toBe(article.id);
		expect(embeddingRow.model_name).toBe("fake-embedder-128");

		const deserializedVec = deserializeFloat32(embeddingRow.embedding);
		expect(deserializedVec).toBeInstanceOf(Float32Array);
		expect(deserializedVec.length).toBe(128);

		const updatedStage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", startRes.stageId)
			.executeTakeFirstOrThrow();

		expect(updatedStage.completed).toBe(1);
		expect(updatedStage.status).toBe("complete");
	});

	test("skips embedding when article_embedding already exists (idempotency)", async () => {
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Test Source",
				url: "https://example.com/rss",
				enabled: 1,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "embed-art-2",
				source_id: source.id,
				title: "Existing Article",
				url: "https://example.com/art-2",
				content: "Content for article 2.",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const existingVec = new Float32Array([1.0, 2.0, 3.0]);
		await db
			.insertInto("article_embedding")
			.values({
				article_id: article.id,
				embedding: serializeFloat32(existingVec),
				model_name: "pre-existing-model",
				created_at: new Date().toISOString(),
			})
			.execute();

		const startRes = await startRun(db, queue, "manual", { stageName: "embed", expectedJobs: 1 });
		expect(startRes.started).toBe(true);
		if (!startRes.started) return;

		const job = {
			id: 11,
			type: EMBED_ARTICLE_JOB_TYPE,
			data: {
				runId: startRes.runId,
				stageId: startRes.stageId,
				articleId: article.id,
			},
		} as any;

		const fakeEmbedder = new FakeEmbedder(128);
		await processEmbedArticleJob(db, job, fakeEmbedder);

		const rows = await db
			.selectFrom("article_embedding")
			.selectAll()
			.where("article_id", "=", article.id)
			.execute();

		expect(rows.length).toBe(1);
		expect(rows[0].model_name).toBe("pre-existing-model");

		const deserialized = deserializeFloat32(rows[0].embedding);
		expect(deserialized[0]).toBeCloseTo(1.0);
	});

	test("handles missing article gracefully and advances stage", async () => {
		const startRes = await startRun(db, queue, "manual", { stageName: "embed", expectedJobs: 1 });
		expect(startRes.started).toBe(true);
		if (!startRes.started) return;

		const job = {
			id: 12,
			type: EMBED_ARTICLE_JOB_TYPE,
			data: {
				runId: startRes.runId,
				stageId: startRes.stageId,
				articleId: 99999,
			},
		} as any;

		await processEmbedArticleJob(db, job);

		const updatedStage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", startRes.stageId)
			.executeTakeFirstOrThrow();

		expect(updatedStage.completed).toBe(1);
	});

	test("uses OpenAiEmbedder fallback when no API key is configured", async () => {
		const origKey = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;

		try {
			const source = await db
				.insertInto("source")
				.values({
					type: "rss",
					name: "Test Source",
					url: "https://example.com/rss",
					enabled: 1,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const article = await db
				.insertInto("article")
				.values({
					identity_key: "embed-art-openai-fallback",
					source_id: source.id,
					title: "OpenAI Fallback Article",
					url: "https://example.com/art-fallback",
					content: "Content for fallback article.",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const startRes = await startRun(db, queue, "manual", { stageName: "embed", expectedJobs: 1 });
			expect(startRes.started).toBe(true);
			if (!startRes.started) return;

			const job = {
				id: 13,
				type: EMBED_ARTICLE_JOB_TYPE,
				data: {
					runId: startRes.runId,
					stageId: startRes.stageId,
					articleId: article.id,
				},
			} as any;

			// Do not pass embedder so processEmbedArticleJob constructs default OpenAiEmbedder
			await processEmbedArticleJob(db, job);

			const embeddingRow = await db
				.selectFrom("article_embedding")
				.selectAll()
				.where("article_id", "=", article.id)
				.executeTakeFirstOrThrow();

			expect(embeddingRow.model_name).toBe("text-embedding-3-small");
			const vec = deserializeFloat32(embeddingRow.embedding);
			expect(vec.length).toBe(1536);
		} finally {
			if (origKey) process.env.OPENAI_API_KEY = origKey;
		}
	});
});
