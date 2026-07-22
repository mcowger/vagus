import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { migrateToLatest } from "../db/migrate";
import type { Database } from "../db/schema";
import {
	buildCitationInserts,
	extractCitationKeysFromText,
	validateAndRepairCitations,
} from "./citations";

describe("Citations Module", () => {
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

	describe("extractCitationKeysFromText", () => {
		test("extracts citation keys from prose with bracketed and plain formats", () => {
			const text =
				"As discussed in [art_10] and art_25, the initial rollout was successful. Further details in [art_10] and art_99.";
			const result = extractCitationKeysFromText(text);

			expect(result).toEqual(["art_10", "art_25", "art_99"]);
		});

		test("returns empty array for text without citations", () => {
			const text = "This summary contains no citation keys whatsoever.";
			expect(extractCitationKeysFromText(text)).toEqual([]);
		});

		test("handles empty string gracefully", () => {
			expect(extractCitationKeysFromText("")).toEqual([]);
		});

		test("deduplicates keys while preserving order of first appearance", () => {
			const text = "art_3 appears first, then [art_1], then art_3 again and [art_1].";
			expect(extractCitationKeysFromText(text)).toEqual(["art_3", "art_1"]);
		});
	});

	describe("validateAndRepairCitations", () => {
		const validArticleMap = new Map<string, number>([
			["art_1", 101],
			["art_2", 102],
			["art_3", 103],
		]);

		test("rejects hallucinated keys not in validArticleMap", () => {
			const rawCitations = ["art_1", "art_999", "art_fake", "art_2"];
			const { validKeys, articleIds } = validateAndRepairCitations(
				rawCitations,
				validArticleMap,
			);

			expect(validKeys).toEqual(["art_1", "art_2"]);
			expect(articleIds).toEqual([101, 102]);
		});

		test("deduplicates citation keys", () => {
			const rawCitations = ["art_1", "[art_1]", "art_2", "art_1", "[art_2]"];
			const { validKeys, articleIds } = validateAndRepairCitations(
				rawCitations,
				validArticleMap,
			);

			expect(validKeys).toEqual(["art_1", "art_2"]);
			expect(articleIds).toEqual([101, 102]);
		});

		test("repairs bracketed citation strings", () => {
			const rawCitations = ["[art_1]", "[art_3]"];
			const { validKeys, articleIds } = validateAndRepairCitations(
				rawCitations,
				validArticleMap,
			);

			expect(validKeys).toEqual(["art_1", "art_3"]);
			expect(articleIds).toEqual([101, 103]);
		});

		test("returns empty arrays if no valid citations exist", () => {
			const rawCitations = ["art_999", "invalid_key"];
			const { validKeys, articleIds } = validateAndRepairCitations(
				rawCitations,
				validArticleMap,
			);

			expect(validKeys).toEqual([]);
			expect(articleIds).toEqual([]);
		});
	});

	describe("buildCitationInserts", () => {
		const validArticleMap = new Map<string, number>([
			["art_10", 501],
			["art_20", 502],
		]);

		test("builds valid Kysely insert objects with cluster ID", () => {
			const citationKeys = ["art_10", "art_999", "art_20", "[art_10]"];
			const inserts = buildCitationInserts(1, 42, validArticleMap, citationKeys);

			expect(inserts).toEqual([
				{
					digest_id: 1,
					digest_cluster_id: 42,
					article_id: 501,
					citation_key: "art_10",
				},
				{
					digest_id: 1,
					digest_cluster_id: 42,
					article_id: 502,
					citation_key: "art_20",
				},
			]);
		});

		test("builds valid Kysely insert objects with null cluster ID", () => {
			const citationKeys = ["[art_10]"];
			const inserts = buildCitationInserts(5, null, validArticleMap, citationKeys);

			expect(inserts).toEqual([
				{
					digest_id: 5,
					digest_cluster_id: null,
					article_id: 501,
					citation_key: "art_10",
				},
			]);
		});

		test("inserts objects successfully into database", async () => {
			// Setup required parent records in DB for foreign key constraints
			const run = await db
				.insertInto("run")
				.values({ trigger: "manual", status: "running" })
				.returningAll()
				.executeTakeFirstOrThrow();

			const source = await db
				.insertInto("source")
				.values({ type: "rss", name: "Test Source", enabled: 1 })
				.returningAll()
				.executeTakeFirstOrThrow();

			const article1 = await db
				.insertInto("article")
				.values({
					identity_key: "id-1",
					source_id: source.id,
					title: "Article 1",
					url: "http://example.com/1",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const article2 = await db
				.insertInto("article")
				.values({
					identity_key: "id-2",
					source_id: source.id,
					title: "Article 2",
					url: "http://example.com/2",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: "user_1",
					executive_summary: "Exec summary",
					key_takeaways: "[]",
					why_it_matters: "Matters",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const cluster = await db
				.insertInto("cluster")
				.values({ run_id: run.id, primary_article_id: article1.id })
				.returningAll()
				.executeTakeFirstOrThrow();

			const digestCluster = await db
				.insertInto("digest_cluster")
				.values({
					digest_id: digest.id,
					cluster_id: cluster.id,
					title: "Cluster title",
					summary: "Cluster summary",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const map = new Map<string, number>([
				[`art_${article1.id}`, article1.id],
				[`art_${article2.id}`, article2.id],
			]);

			const inserts = buildCitationInserts(
				digest.id,
				digestCluster.id,
				map,
				[`art_${article1.id}`, `art_${article2.id}`],
			);

			await db.insertInto("citation").values(inserts).execute();

			const dbCitations = await db
				.selectFrom("citation")
				.selectAll()
				.where("digest_id", "=", digest.id)
				.execute();

			expect(dbCitations).toHaveLength(2);
			expect(dbCitations[0].citation_key).toBe(`art_${article1.id}`);
			expect(dbCitations[0].article_id).toBe(article1.id);
			expect(dbCitations[1].citation_key).toBe(`art_${article2.id}`);
			expect(dbCitations[1].article_id).toBe(article2.id);
		});
	});
});
