import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { migrateToLatest } from "../db/migrate";
import type { Database } from "../db/schema";
import { processExtractArticleJob } from "./extract-job";
import { EXTRACT_ARTICLE_JOB_TYPE } from "./extraction-contracts";

const sampleHtml = readFileSync(
	join(import.meta.dir, "../extractor/fixtures/sample_article.html"),
	"utf-8",
);

describe("extract-job", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);
	});

	afterEach(async () => {
		await db.destroy();
		sqlite.close();
	});

	test("updates article with pre-existing content and advances stage", async () => {
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
				identity_key: "key-1",
				source_id: source.id,
				title: "Pre-existing Article",
				url: "https://example.com/art1",
				content: "<p>Pre-extracted article content for testing.</p>",
				author: "Author A",
				publish_date: "2026-07-22T00:00:00Z",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const run = await db
			.insertInto("run")
			.values({
				trigger: "manual",
				status: "running",
				started_at: new Date().toISOString(),
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const stage = await db
			.insertInto("run_stage")
			.values({
				run_id: run.id,
				stage: "extract",
				expected: 1,
				completed: 0,
				status: "running",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const job = {
			id: 101,
			type: EXTRACT_ARTICLE_JOB_TYPE,
			data: JSON.stringify({
				runId: run.id,
				stageId: stage.id,
				articleId: article.id,
			}),
		} as any;

		await processExtractArticleJob(db, job);

		const updatedArticle = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", article.id)
			.executeTakeFirstOrThrow();

		expect(updatedArticle.content).toBe("Pre-extracted article content for testing.");
		expect(updatedArticle.reading_time_minutes).toBe(1);

		const updatedStage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", stage.id)
			.executeTakeFirstOrThrow();

		expect(updatedStage.completed).toBe(1);
		expect(updatedStage.status).toBe("complete");
	});

	test("fetches and extracts HTML when content is null", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(sampleHtml, { status: 200 });

		try {
			const source = await db
				.insertInto("source")
				.values({
					type: "scrape",
					name: "Scrape Source",
					url: "https://example.com",
					enabled: 1,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const article = await db
				.insertInto("article")
				.values({
					identity_key: "key-scrape-1",
					source_id: source.id,
					title: "Scraped Article",
					url: "https://example.com/sample-article",
					content: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const run = await db
				.insertInto("run")
				.values({
					trigger: "manual",
					status: "running",
					started_at: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const stage = await db
				.insertInto("run_stage")
				.values({
					run_id: run.id,
					stage: "extract",
					expected: 1,
					completed: 0,
					status: "running",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const job = {
				id: 102,
				type: EXTRACT_ARTICLE_JOB_TYPE,
				data: {
					runId: run.id,
					stageId: stage.id,
					articleId: article.id,
				},
			} as any;

			await processExtractArticleJob(db, job);

			const updatedArticle = await db
				.selectFrom("article")
				.selectAll()
				.where("id", "=", article.id)
				.executeTakeFirstOrThrow();

			expect(updatedArticle.title).toContain("Sample Article Title for Testing");
			expect(updatedArticle.author).toBe("Jane Doe");
			expect(updatedArticle.image_url).toBe("https://example.com/sample-image.jpg");
			expect(updatedArticle.publish_date).toBe("2026-07-22T10:00:00Z");
			expect(updatedArticle.content).toContain("This is the main body of the article");
			expect(updatedArticle.reading_time_minutes).toBeGreaterThanOrEqual(1);

			const updatedStage = await db
				.selectFrom("run_stage")
				.selectAll()
				.where("id", "=", stage.id)
				.executeTakeFirstOrThrow();

			expect(updatedStage.completed).toBe(1);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	test("handles missing article gracefully and advances stage", async () => {
		const run = await db
			.insertInto("run")
			.values({
				trigger: "manual",
				status: "running",
				started_at: new Date().toISOString(),
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const stage = await db
			.insertInto("run_stage")
			.values({
				run_id: run.id,
				stage: "extract",
				expected: 1,
				completed: 0,
				status: "running",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const job = {
			id: 103,
			type: EXTRACT_ARTICLE_JOB_TYPE,
			data: {
				runId: run.id,
				stageId: stage.id,
				articleId: 99999,
			},
		} as any;

		await processExtractArticleJob(db, job);

		const updatedStage = await db
			.selectFrom("run_stage")
			.selectAll()
			.where("id", "=", stage.id)
			.executeTakeFirstOrThrow();

		expect(updatedStage.completed).toBe(1);
	});
});
