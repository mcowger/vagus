import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, defineWorker, type Queue, type Worker } from "plainjob";
import { RssAdapter } from "../adapters/rss";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { FETCH_SOURCE_JOB_TYPE, processFetchSourceJob, type FetchSourceJobData } from "./ingestion";
import { createPlainjobConnection } from "./index";
import { advanceStage, startRun } from "./coordinator";

describe("Ingestion Core & Idempotency", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;
	let queue: Queue;
	let worker: Worker;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
		});

		worker = defineWorker(
			FETCH_SOURCE_JOB_TYPE,
			(job) => processFetchSourceJob(db, job),
			{
				queue,
				pollIntervall: 50,
				onCompleted: (job: any) => {
					try {
						const data = (typeof job.data === "string" ? JSON.parse(job.data) : job.data) as FetchSourceJobData;
						if (data?.stageId) {
							void advanceStage(db, data.stageId, job.id);
						}
					} catch {}
				},
			} as any,
		);
		void worker.start();
	});

	afterEach(async () => {
		await worker.stop();
		queue.close();
		await db.destroy();
		sqlite.close();
	});

	test("Fetches enabled source and stores articles idempotently", async () => {
		// Mock fetch for RSS source
		const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>Test Feed</title>
 <link>https://example.com</link>
 <item>
  <title>Article 1</title>
  <link>https://example.com/1</link>
  <guid>item-1</guid>
 </item>
</channel>
</rss>`;

		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response(xml, { status: 200 })) as unknown as typeof fetch;

		try {
			// Insert test source
			const source = await db
				.insertInto("source")
				.values({
					type: "rss",
					name: "Test RSS",
					url: "https://example.com/rss",
					enabled: 1,
					owner_user_id: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			// Start run
			const startRes = await startRun(db, queue, "manual");
			expect(startRes.started).toBe(true);

			if (startRes.started) {
				const job = {
					id: 1,
					type: FETCH_SOURCE_JOB_TYPE,
					data: {
						runId: startRes.runId,
						stageId: startRes.stageId,
						sourceId: source.id,
					},
					status: "pending",
				} as any;

				await processFetchSourceJob(db, job);
				await advanceStage(db, startRes.stageId, job.id);
			}

			// Verify article inserted
			const articles = await db.selectFrom("article").selectAll().execute();
			expect(articles.length).toBe(1);
			expect(articles[0].title).toBe("Article 1");
			expect(articles[0].identity_key).toBe("item-1");

			// Verify processed_key inserted
			const keys = await db.selectFrom("processed_key").selectAll().execute();
			expect(keys.length).toBe(1);
			expect(keys[0].identity_key).toBe("item-1");

			// Re-run immediately: verify idempotency (0 new articles inserted)
			const reRunRes = await startRun(db, queue, "manual");
			expect(reRunRes.started).toBe(true);

			if (reRunRes.started) {
				const job2 = {
					id: 2,
					type: FETCH_SOURCE_JOB_TYPE,
					data: {
						runId: reRunRes.runId,
						stageId: reRunRes.stageId,
						sourceId: source.id,
					},
					status: "pending",
				} as any;

				await processFetchSourceJob(db, job2);
			}

			const articlesAfterReRun = await db.selectFrom("article").selectAll().execute();
			expect(articlesAfterReRun.length).toBe(1); // Still 1!
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
