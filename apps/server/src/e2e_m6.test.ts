import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import type { Database } from "./db/schema";
import { migrateToLatest } from "./db/migrate";
import { createPlainjobConnection } from "./queue";
import { startScheduler, stopScheduler, triggerManualRun } from "./scheduler";
import { sendDigestNotification } from "./notifications/ntfy";
import { pruneOldData } from "./retention/prune";
import { log } from "./log";

describe("Milestone 6 Multi-Tenant E2E Test (Scheduling, Notifications & Retention)", () => {
	let sqlite: BunSqliteDatabase;
	let db: Kysely<Database>;
	let queue: Queue;

	beforeEach(async () => {
		sqlite = new BunSqliteDatabase(":memory:");
		sqlite.exec("PRAGMA foreign_keys = ON;");

		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});

		await migrateToLatest(db);

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
			logger: log,
		});
	});

	afterEach(async () => {
		stopScheduler();
		queue.close();
		await db.destroy();
	});

	test("executes scheduled run with overlap guard, debounced ntfy push, and idempotency-safe retention pruning", async () => {
		const now = new Date().toISOString();

		// 1. Setup system settings
		await db
			.insertInto("system_setting")
			.values({ key: "ntfy_base_url", value: "https://ntfy.example.com", updated_at: now })
			.onConflict((oc) => oc.column("key").doUpdateSet({ value: "https://ntfy.example.com" }))
			.execute();

		await db
			.insertInto("system_setting")
			.values({ key: "app_base_url", value: "https://vagus.example.com", updated_at: now })
			.onConflict((oc) => oc.column("key").doUpdateSet({ value: "https://vagus.example.com" }))
			.execute();

		// 2. Setup test source
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "AI Weekly",
				url: "https://example.com/rss",
				enabled: 1,
				created_at: now,
				updated_at: now,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// 3. Setup User Interest Profile with ntfy_topic
		const userId = "user-m6-test";
		await db
			.insertInto("interest_profile")
			.values({
				user_id: userId,
				name: "AI & Tech",
				keywords: JSON.stringify(["AI", "LLM"]),
				topics: JSON.stringify(["Artificial Intelligence"]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				similarity_threshold: 0.6,
				max_cluster_cap: 5,
				ntfy_topic: "vagus-user-m6-topic",
				created_at: now,
				updated_at: now,
			})
			.execute();

		// 4. Test Scheduler & Overlap Guard
		const runRes1 = await triggerManualRun(db, queue, { expectedJobs: 1 });
		expect(runRes1.started).toBe(true);

		// Second run while run 1 is active must be rejected by overlap guard
		const runRes2 = await triggerManualRun(db, queue, { expectedJobs: 1 });
		expect(runRes2.started).toBe(false);
		if (!runRes2.started) {
			expect(runRes2.reason).toBe("overlap");
		}

		// 5. Test Notification with ntfy push mock
		const digest = await db
			.insertInto("digest")
			.values({
				run_id: runRes1.started ? runRes1.runId : 1,
				user_id: userId,
				executive_summary: "Daily AI Briefing: Major LLM breakthrough announced.",
				why_it_matters: "Significant impact on autonomous software development.",
				key_takeaways: JSON.stringify(["LLMs achieve near-zero hallucination rates"]),
				key_quotes: JSON.stringify([]),
				created_at: now,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const sentUrls: string[] = [];
		const sentHeaders: Record<string, string>[] = [];

		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			sentUrls.push(String(url));
			const headersObj: Record<string, string> = {};
			if (init?.headers) {
				const h = new Headers(init.headers);
				h.forEach((v, k) => {
					headersObj[k.toLowerCase()] = v;
				});
			}
			sentHeaders.push(headersObj);
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			// First notification attempt
			const notif1 = await sendDigestNotification(db, digest.id, userId);
			expect(notif1.sent).toBe(true);
			expect(sentUrls.length).toBe(1);
			expect(sentUrls[0]).toBe("https://ntfy.example.com/vagus-user-m6-topic");
			expect(sentHeaders[0]["click"]).toBe(`https://vagus.example.com/digests/${digest.id}`);

			// Second notification attempt (Debounce check)
			const notif2 = await sendDigestNotification(db, digest.id, userId);
			expect(notif2.sent).toBe(false);
			expect(notif2.reason).toBe("Already sent");
			expect(sentUrls.length).toBe(1); // No second HTTP POST dispatched
		} finally {
			globalThis.fetch = origFetch;
		}

		// 6. Test Retention Pruning & Processed Key Preservation
		const oldDate = new Date(Date.now() - 40 * 86400 * 1000).toISOString(); // 40 days old

		const oldArticle = await db
			.insertInto("article")
			.values({
				identity_key: "old-article-key-1",
				source_id: source.id,
				title: "Old AI Article",
				url: "https://example.com/old-ai-article",
				content: "Old news content",
				created_at: oldDate,
				fetched_at: oldDate,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const oldKey = await db
			.insertInto("processed_key")
			.values({
				identity_key: "old-article-key-1",
				source_id: source.id,
				processed_at: oldDate,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// Prune
		const pruneResult = await pruneOldData(db);
		expect(pruneResult.prunedArticles).toBe(1);

		// Assert old article is removed
		const checkedArt = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", oldArticle.id)
			.executeTakeFirst();
		expect(checkedArt).toBeUndefined();

		// CRITICAL SECURITY ASSERTION: processed_key MUST remain intact!
		const checkedKey = await db
			.selectFrom("processed_key")
			.selectAll()
			.where("id", "=", oldKey.id)
			.executeTakeFirst();
		expect(checkedKey).toBeDefined();
		expect(checkedKey?.identity_key).toBe("old-article-key-1");
	});
});
