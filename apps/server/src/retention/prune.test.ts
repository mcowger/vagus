import { describe, expect, test } from "bun:test";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { migrateToLatest } from "../db/migrate";
import type { Database } from "../db/schema";
import { pruneOldData } from "./prune";

async function createTestDb(): Promise<{ db: Kysely<Database>; sqlite: BunSqliteDatabase }> {
	const sqlite = new BunSqliteDatabase(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");

	const db = new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite }),
	});

	await migrateToLatest(db);

	return { db, sqlite };
}

describe("Retention Pruning Engine", () => {
	test("prunes articles older than 30 days and digests older than 90 days while preserving recent data and processed_key rows", async () => {
		const { db } = await createTestDb();

		const nowMs = Date.now();
		const daysAgo = (days: number) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

		// 1. Setup Source & Processed Keys
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Test Feed",
				url: "https://example.com/rss",
				enabled: 1,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("processed_key")
			.values([
				{ identity_key: "key-old-article", source_id: source.id, processed_at: daysAgo(35) },
				{ identity_key: "key-recent-article", source_id: source.id, processed_at: daysAgo(5) },
			])
			.execute();

		// 2. Setup Articles & Embeddings
		const oldArticle = await db
			.insertInto("article")
			.values({
				identity_key: "key-old-article",
				source_id: source.id,
				title: "Old Article (35d old)",
				url: "https://example.com/old",
				created_at: daysAgo(35),
				fetched_at: daysAgo(35),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const recentArticle = await db
			.insertInto("article")
			.values({
				identity_key: "key-recent-article",
				source_id: source.id,
				title: "Recent Article (5d old)",
				url: "https://example.com/recent",
				created_at: daysAgo(5),
				fetched_at: daysAgo(5),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("article_embedding")
			.values([
				{
					article_id: oldArticle.id,
					embedding: new Uint8Array([1, 2, 3]),
					model_name: "test-model",
					created_at: daysAgo(35),
				},
				{
					article_id: recentArticle.id,
					embedding: new Uint8Array([4, 5, 6]),
					model_name: "test-model",
					created_at: daysAgo(5),
				},
			])
			.execute();

		// 3. Setup Run, Cluster, Digests, Clusters & Citations
		const run = await db
			.insertInto("run")
			.values({ trigger: "manual", status: "complete", started_at: daysAgo(100) })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const cluster = await db
			.insertInto("cluster")
			.values({
				run_id: run.id,
				primary_article_id: recentArticle.id,
				summary_title: "Test Cluster",
				created_at: daysAgo(100),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const oldDigest = await db
			.insertInto("digest")
			.values({
				run_id: run.id,
				user_id: "user-1",
				executive_summary: "Old Digest Summary",
				why_it_matters: "Why it mattered then",
				created_at: daysAgo(95),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const recentDigest = await db
			.insertInto("digest")
			.values({
				run_id: run.id,
				user_id: "user-1",
				executive_summary: "Recent Digest Summary",
				why_it_matters: "Why it matters now",
				created_at: daysAgo(10),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const oldDigestCluster = await db
			.insertInto("digest_cluster")
			.values({
				digest_id: oldDigest.id,
				cluster_id: cluster.id,
				title: "Old Digest Cluster",
				summary: "Summary",
				created_at: daysAgo(95),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const recentDigestCluster = await db
			.insertInto("digest_cluster")
			.values({
				digest_id: recentDigest.id,
				cluster_id: cluster.id,
				title: "Recent Digest Cluster",
				summary: "Summary",
				created_at: daysAgo(10),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("citation")
			.values([
				{
					digest_id: oldDigest.id,
					digest_cluster_id: oldDigestCluster.id,
					article_id: recentArticle.id,
					citation_key: "art_1",
					created_at: daysAgo(95),
				},
				{
					digest_id: recentDigest.id,
					digest_cluster_id: recentDigestCluster.id,
					article_id: recentArticle.id,
					citation_key: "art_2",
					created_at: daysAgo(10),
				},
			])
			.execute();

		// 4. Run Pruning
		const result = await pruneOldData(db);

		expect(result).toEqual({ prunedArticles: 1, prunedDigests: 1 });

		// 5. Verify Articles & Embeddings
		const articles = await db.selectFrom("article").selectAll().execute();
		expect(articles.map((a) => a.id)).toEqual([recentArticle.id]);

		const embeddings = await db.selectFrom("article_embedding").selectAll().execute();
		expect(embeddings.map((e) => e.article_id)).toEqual([recentArticle.id]);

		// 6. Verify Digests, Digest Clusters & Citations
		const digests = await db.selectFrom("digest").selectAll().execute();
		expect(digests.map((d) => d.id)).toEqual([recentDigest.id]);

		const digestClusters = await db.selectFrom("digest_cluster").selectAll().execute();
		expect(digestClusters.map((dc) => dc.digest_id)).toEqual([recentDigest.id]);

		const citations = await db.selectFrom("citation").selectAll().execute();
		expect(citations.map((c) => c.digest_id)).toEqual([recentDigest.id]);

		// 7. CRITICAL SECURITY REQUIREMENT: Verify processed_key entries remain 100% intact!
		const processedKeys = await db.selectFrom("processed_key").selectAll().execute();
		expect(processedKeys).toHaveLength(2);
		expect(processedKeys.map((pk) => pk.identity_key).sort()).toEqual([
			"key-old-article",
			"key-recent-article",
		]);
	});

	test("respects custom retention windows configured in system_setting", async () => {
		const { db } = await createTestDb();

		const nowMs = Date.now();
		const daysAgo = (days: number) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

		// Configure custom 10d article retention and 20d digest retention
		await db
			.updateTable("system_setting")
			.set({ value: "10" })
			.where("key", "=", "article_retention_days")
			.execute();

		await db
			.updateTable("system_setting")
			.set({ value: "20" })
			.where("key", "=", "digest_retention_days")
			.execute();

		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Custom Settings Feed",
				url: "https://example.com/rss2",
				enabled: 1,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const art15d = await db
			.insertInto("article")
			.values({
				identity_key: "key-15d",
				source_id: source.id,
				title: "Article 15d old",
				url: "https://example.com/15d",
				created_at: daysAgo(15),
				fetched_at: daysAgo(15),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const art5d = await db
			.insertInto("article")
			.values({
				identity_key: "key-5d",
				source_id: source.id,
				title: "Article 5d old",
				url: "https://example.com/5d",
				created_at: daysAgo(5),
				fetched_at: daysAgo(5),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const run = await db
			.insertInto("run")
			.values({ trigger: "manual", status: "complete", started_at: daysAgo(30) })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const digest25d = await db
			.insertInto("digest")
			.values({
				run_id: run.id,
				user_id: "user-1",
				executive_summary: "Digest 25d old",
				why_it_matters: "Why",
				created_at: daysAgo(25),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const digest15d = await db
			.insertInto("digest")
			.values({
				run_id: run.id,
				user_id: "user-1",
				executive_summary: "Digest 15d old",
				why_it_matters: "Why",
				created_at: daysAgo(15),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const result = await pruneOldData(db);

		expect(result).toEqual({ prunedArticles: 1, prunedDigests: 1 });

		const articles = await db.selectFrom("article").selectAll().execute();
		expect(articles.map((a) => a.id)).toEqual([art5d.id]);

		const digests = await db.selectFrom("digest").selectAll().execute();
		expect(digests.map((d) => d.id)).toEqual([digest15d.id]);
	});

	test("handles missing or non-numeric system settings gracefully by falling back to defaults", async () => {
		const { db } = await createTestDb();

		const nowMs = Date.now();
		const daysAgo = (days: number) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

		// Delete system settings to test fallback
		await db.deleteFrom("system_setting").execute();

		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Fallback Feed",
				url: "https://example.com/rss3",
				enabled: 1,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("article")
			.values({
				identity_key: "key-35d",
				source_id: source.id,
				title: "Article 35d old",
				url: "https://example.com/35d",
				created_at: daysAgo(35),
				fetched_at: daysAgo(35),
			})
			.execute();

		const result = await pruneOldData(db);

		expect(result).toEqual({ prunedArticles: 1, prunedDigests: 0 });
	});
});
