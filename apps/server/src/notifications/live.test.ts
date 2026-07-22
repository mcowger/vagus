import { describe, expect, test } from "bun:test";
import { sanitizeAsciiHeader, sendDigestNotification } from "./ntfy";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";

const isLiveRequested = process.env.RUN_LIVE_TESTS === "1" || process.env.TEST_LIVE === "1";

describe("Live ntfy Notification Integration Test", () => {
	if (!isLiveRequested) {
		test.skip("Skipping live test: RUN_LIVE_TESTS=1 not set", () => {});
		return;
	}

	test(
		"dispatches live push notification to public ntfy server",
		async () => {
			const sqlite = new BunSqliteDatabase(":memory:");
			sqlite.exec("PRAGMA foreign_keys = ON;");

			const db = new Kysely<Database>({
				dialect: new BunSqliteDialect({ database: sqlite }),
			});

			await migrateToLatest(db);

			const liveTopic = `vagus-test-live-${Date.now()}`;
			const now = new Date().toISOString();

			// Configure system_setting to point to public ntfy.sh or custom TESTING_NTFY_BASE_URL
			const ntfyBaseUrl = process.env.TESTING_NTFY_BASE_URL || "https://ntfy.sh";

			await db
				.insertInto("system_setting")
				.values({ key: "ntfy_base_url", value: ntfyBaseUrl, updated_at: now })
				.onConflict((oc) => oc.column("key").doUpdateSet({ value: ntfyBaseUrl }))
				.execute();

			const userId = "user-live-notif-test";
			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Live Test Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					similarity_threshold: 0.6,
					max_cluster_cap: 5,
					ntfy_topic: liveTopic,
					created_at: now,
					updated_at: now,
				})
				.execute();

			const run = await db
				.insertInto("run")
				.values({ trigger: "manual", status: "complete", started_at: now })
				.returning(["id"])
				.executeTakeFirstOrThrow();

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "Live Integration Test Digest Overview.",
					why_it_matters: "Testing live ntfy push notification delivery.",
					key_takeaways: JSON.stringify(["Push delivery confirmed"]),
					key_quotes: JSON.stringify([]),
					created_at: now,
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			// Dispatch live notification to ntfy.sh
			const result = await sendDigestNotification(db, digest.id, userId);
			expect(result.sent).toBe(true);

			await db.destroy();
		},
		{ timeout: 15000 },
	);
});
