import { describe, expect, it } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "../../db/schema";
import { migrateToLatest } from "../../db/migrate";
import { scoreClustersForUser } from "../../scoring/index";

async function createTestDb(): Promise<Kysely<Database>> {
	const sqlite = new SQLite(":memory:");
	const db = new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite }),
	});
	await migrateToLatest(db);
	return db;
}

describe("Feedback Router & Source Weighting", () => {
	it("mutes story clusters when user source weight drops to 0", async () => {
		const db = await createTestDb();
		const userId = "user-mute-test";
		const now = new Date().toISOString();

		const source = await db
			.insertInto("source")
			.values({
				name: "Fox News",
				type: "rss",
				url: "https://example.com/fox",
				enabled: 1,
				owner_user_id: null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const run = await db
			.insertInto("run")
			.values({ trigger: "manual", status: "running", started_at: now })
			.returningAll()
			.executeTakeFirstOrThrow();

		const article = await db
			.insertInto("article")
			.values({
				identity_key: "fox-1",
				source_id: source.id,
				title: "Headline News",
				url: "https://example.com/fox/1",
				content: "Sample content",
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const cluster = await db
			.insertInto("cluster")
			.values({ run_id: run.id, primary_article_id: article.id, summary_title: "Fox Story" })
			.returningAll()
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: cluster.id, article_id: article.id, is_primary: 1, created_at: now })
			.execute();

		// Mute the source for this user
		await db
			.insertInto("user_source_weight")
			.values({
				user_id: userId,
				source_id: source.id,
				weight: 0.0,
				updated_at: now,
			})
			.execute();

		const scores = await scoreClustersForUser(db, run.id, userId);
		const foxScore = scores.find((s) => s.clusterId === cluster.id);

		// Muted cluster (score = 0) is excluded from selected digest clusters
		expect(foxScore).toBeUndefined();
	});
});
