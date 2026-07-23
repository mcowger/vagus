import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Queue } from "plainjob";
import { clusterRunArticles, computeJaccardSimilarity, selectPrimaryArticle, tokenizeTitle } from "./index";
import { processClusterRunJob } from "../queue/cluster-job";
import { CLUSTER_RUN_JOB_TYPE, type ClusterRunJobData } from "../queue/clustering-contracts";
import { advanceStage, startRun } from "../queue/coordinator";
import { createPlainjobConnection } from "../queue/index";
import { migrateToLatest } from "../db/migrate";
import type { Database } from "../db/schema";
import { serializeFloat32 } from "../embeddings/types";

describe("Clustering Module & Job", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;
	let queue: Queue;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);
		await db
			.updateTable("system_setting")
			.set({ value: "87600" })
			.where("key", "=", "pipeline_article_max_age_hours")
			.execute();

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
		});
	});

	afterEach(async () => {
		queue.close();
		await db.destroy();
		sqlite.close();
	});

	describe("Utility Functions", () => {
		test("tokenizeTitle converts title to lowercased word token set", () => {
			const tokens = tokenizeTitle("Apple's new M4 MacBook Pro!");
			expect(tokens.has("apple")).toBe(true);
			expect(tokens.has("s")).toBe(true);
			expect(tokens.has("new")).toBe(true);
			expect(tokens.has("m4")).toBe(true);
			expect(tokens.has("macbook")).toBe(true);
			expect(tokens.has("pro")).toBe(true);
		});

		test("computeJaccardSimilarity calculates intersection over union ratio", () => {
			const setA = new Set(["apple", "macbook", "pro", "m4"]);
			const setB = new Set(["apple", "macbook", "pro", "m4", "announced"]);
			// Intersection: 4, Union: 5 -> 0.8
			expect(computeJaccardSimilarity(setA, setB)).toBeCloseTo(0.8);

			const emptySet = new Set<string>();
			expect(computeJaccardSimilarity(setA, emptySet)).toBe(0);
		});

		test("selectPrimaryArticle picks earliest publish_date then longest content", () => {
			const artEarly = {
				id: 1,
				publish_date: "2026-07-20T08:00:00Z",
				content: "Short content",
			};
			const artLate = {
				id: 2,
				publish_date: "2026-07-20T12:00:00Z",
				content: "Very long content spanning multiple paragraphs",
			};

			const primary1 = selectPrimaryArticle([artEarly, artLate]);
			expect(primary1.id).toBe(1);

			// Equal publish_date -> pick longest content
			const artEqualDateLonger = {
				id: 3,
				publish_date: "2026-07-20T08:00:00Z",
				content: "Much longer content spanning multiple paragraphs",
			};
			const primary2 = selectPrimaryArticle([artEarly, artEqualDateLonger]);
			expect(primary2.id).toBe(3);

			// Missing publish_date vs known publish_date -> prefer known date
			const artNoDate = {
				id: 4,
				publish_date: null,
				content: "Huge content",
			};
			const primary3 = selectPrimaryArticle([artNoDate, artEarly]);
			expect(primary3.id).toBe(1);
		});
	});

	describe("clusterRunArticles", () => {
		test("Groups articles using Float32 vector embeddings and cosine similarity", async () => {
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

			const art1 = await db
				.insertInto("article")
				.values({
					run_id: 100,
					identity_key: "art-1",
					source_id: source.id,
					title: "Tech Article 1",
					url: "https://example.com/1",
					content: "Article 1 content",
					publish_date: "2026-07-20T10:00:00Z",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const art2 = await db
				.insertInto("article")
				.values({
					run_id: 100,
					identity_key: "art-2",
					source_id: source.id,
					title: "Tech Article 2",
					url: "https://example.com/2",
					content: "Article 2 content longer version",
					publish_date: "2026-07-20T09:00:00Z",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const art3 = await db
				.insertInto("article")
				.values({
					run_id: 100,
					identity_key: "art-3",
					source_id: source.id,
					title: "Unrelated Cooking News",
					url: "https://example.com/3",
					content: "Cooking recipe content",
					publish_date: "2026-07-20T11:00:00Z",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			// Embeddings: art1 and art2 are nearly identical vectors ([1, 0, 0]), art3 is orthogonal ([0, 1, 0])
			const vec1 = new Float32Array([1.0, 0.0, 0.0]);
			const vec2 = new Float32Array([0.98, 0.1, 0.0]); // Cosine sim ~0.98 >= 0.80
			const vec3 = new Float32Array([0.0, 1.0, 0.0]);

			await db
				.insertInto("article_embedding")
				.values([
					{
						article_id: art1.id,
						embedding: serializeFloat32(vec1),
						model_name: "test-model",
					},
					{
						article_id: art2.id,
						embedding: serializeFloat32(vec2),
						model_name: "test-model",
					},
					{
						article_id: art3.id,
						embedding: serializeFloat32(vec3),
						model_name: "test-model",
					},
				])
				.execute();

			const result = await clusterRunArticles(db, 100);

			expect(result.clusters.length).toBe(2);

			// Find cluster containing art1 & art2
			const clusterA = result.clusters.find(
				(c) => c.primary_article_id === art1.id || c.primary_article_id === art2.id,
			);
			expect(clusterA).toBeDefined();

			const clusterAArticles = result.clusterArticles.filter((ca) => ca.cluster_id === clusterA!.id);
			expect(clusterAArticles.length).toBe(2);

			// Primary should be art2 because publish_date 09:00 is earlier than 10:00
			expect(clusterA!.primary_article_id).toBe(art2.id);

			const art2CA = clusterAArticles.find((ca) => ca.article_id === art2.id);
			expect(art2CA?.is_primary).toBe(1);

			const art1CA = clusterAArticles.find((ca) => ca.article_id === art1.id);
			expect(art1CA?.is_primary).toBe(0);

			// Find cluster containing art3
			const clusterB = result.clusters.find((c) => c.primary_article_id === art3.id);
			expect(clusterB).toBeDefined();
			const clusterBArticles = result.clusterArticles.filter((ca) => ca.cluster_id === clusterB!.id);
			expect(clusterBArticles.length).toBe(1);
		});

		test("Falls back to lexical title Jaccard similarity for articles without embeddings", async () => {
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

			const art1 = await db
				.insertInto("article")
				.values({
					run_id: 101,
					identity_key: "lex-1",
					source_id: source.id,
					title: "SpaceX Starship Launches Heavy Rocket Payload",
					url: "https://example.com/lex-1",
					content: "Content 1",
					publish_date: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const art2 = await db
				.insertInto("article")
				.values({
					run_id: 101,
					identity_key: "lex-2",
					source_id: source.id,
					title: "SpaceX Starship Launches Heavy Rocket Payload Today",
					url: "https://example.com/lex-2",
					content: "Content 2",
					publish_date: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const art3 = await db
				.insertInto("article")
				.values({
					run_id: 101,
					identity_key: "lex-3",
					source_id: source.id,
					title: "Central Banks Raise Baseline Interest Rates",
					url: "https://example.com/lex-3",
					content: "Content 3",
					publish_date: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			// No embeddings inserted in article_embedding table!
			const result = await clusterRunArticles(db, 101);

			expect(result.clusters.length).toBe(2);

			const starshipCluster = result.clusters.find(
				(c) => c.primary_article_id === art1.id || c.primary_article_id === art2.id,
			);
			expect(starshipCluster).toBeDefined();

			const starshipArticles = result.clusterArticles.filter(
				(ca) => ca.cluster_id === starshipCluster!.id,
			);
			expect(starshipArticles.length).toBe(2);

			const bankCluster = result.clusters.find((c) => c.primary_article_id === art3.id);
			expect(bankCluster).toBeDefined();
		});

		test("clusters eligible articles from prior runs into the current digest run", async () => {
			const source = await db
				.insertInto("source")
				.values({ type: "rss", name: "Test Source", url: "https://example.com/rss", enabled: 1 })
				.returningAll()
				.executeTakeFirstOrThrow();
			const articles = await db
				.insertInto("article")
				.values([
					{ run_id: 401, identity_key: "prior-run", source_id: source.id, title: "Iran war funding request", url: "https://example.com/prior", content: "Prior coverage", publish_date: new Date().toISOString() },
					{ run_id: 402, identity_key: "current-run", source_id: source.id, title: "Iran war funding request update", url: "https://example.com/current", content: "Current coverage", publish_date: new Date().toISOString() },
				])
				.returningAll()
				.execute();
			await db
				.insertInto("article_embedding")
				.values(articles.map((article) => ({ article_id: article.id, embedding: serializeFloat32(new Float32Array([1, 0, 0])), model_name: "test" })))
				.execute();

			const result = await clusterRunArticles(db, 402, { threshold: 0.8 });

			expect(result.clusters).toHaveLength(1);
			expect(result.clusterArticles).toHaveLength(2);
		});

		test("Maintains idempotency on repeated calls for same runId", async () => {
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

			await db
				.insertInto("article")
				.values({
					run_id: 200,
					identity_key: "idempotent-1",
					source_id: source.id,
					title: "Unique Title",
					url: "https://example.com/idempotent-1",
					content: "Content",
					publish_date: new Date().toISOString(),
				})
				.execute();

			const runId = 200;

			// Run 1
			const res1 = await clusterRunArticles(db, runId);
			expect(res1.clusters.length).toBe(1);

			// Run 2
			const res2 = await clusterRunArticles(db, runId);
			expect(res2.clusters.length).toBe(1);

			const allClustersInDB = await db
				.selectFrom("cluster")
				.selectAll()
				.where("run_id", "=", runId)
				.execute();

			expect(allClustersInDB.length).toBe(1);
		});

		test("Respects custom similarity threshold", async () => {
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

			const art1 = await db
				.insertInto("article")
				.values({
					run_id: 300,
					identity_key: "thresh-1",
					source_id: source.id,
					title: "AI Breakthrough Announcement",
					url: "https://example.com/t1",
					content: "AI breakthrough coverage",
					publish_date: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const art2 = await db
				.insertInto("article")
				.values({
					run_id: 300,
					identity_key: "thresh-2",
					source_id: source.id,
					title: "AI Breakthrough Announcement Details",
					url: "https://example.com/t2",
					content: "AI breakthrough details",
					publish_date: new Date().toISOString(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			// Vecs with similarity ~0.85
			const vec1 = new Float32Array([1.0, 0.0, 0.0]);
			const vec2 = new Float32Array([0.85, 0.526, 0.0]);

			await db
				.insertInto("article_embedding")
				.values([
					{ article_id: art1.id, embedding: serializeFloat32(vec1), model_name: "test" },
					{ article_id: art2.id, embedding: serializeFloat32(vec2), model_name: "test" },
				])
				.execute();

			// Default threshold 0.80 -> 1 cluster
			const resDefault = await clusterRunArticles(db, 300, { threshold: 0.8 });
			expect(resDefault.clusters.length).toBe(1);

			// Strict threshold 0.95 -> 2 clusters
			const resStrict = await clusterRunArticles(db, 300, { threshold: 0.95 });
			expect(resStrict.clusters.length).toBe(2);
		});
	});

	describe("processClusterRunJob", () => {
		test("Processes cluster-run job and advances stage", async () => {
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

			await db
				.insertInto("article")
				.values({
					identity_key: "job-art-1",
					source_id: source.id,
					title: "Job Test Article",
					url: "https://example.com/job-1",
					content: "Job test content",
					publish_date: new Date().toISOString(),
				})
				.execute();

			const startRes = await startRun(db, queue, "manual", {
				stageName: "cluster",
				expectedJobs: 1,
			});
			expect(startRes.started).toBe(true);

			if (!startRes.started) return;

			const jobData: ClusterRunJobData = {
				runId: startRes.runId,
				stageId: startRes.stageId,
			};

			await db
				.updateTable("article")
				.set({ run_id: startRes.runId })
				.where("identity_key", "=", "job-art-1")
				.execute();

			const job = {
				id: 50,
				type: CLUSTER_RUN_JOB_TYPE,
				data: jobData,
				status: "pending",
			} as any;

			await processClusterRunJob(db, job);

			// Verify clusters created
			const clusters = await db
				.selectFrom("cluster")
				.selectAll()
				.where("run_id", "=", startRes.runId)
				.execute();

			expect(clusters.length).toBe(1);

			// Verify run_stage completed
			const stage = await db
				.selectFrom("run_stage")
				.selectAll()
				.where("id", "=", startRes.stageId)
				.executeTakeFirstOrThrow();

			expect(stage.status).toBe("complete");
			expect(stage.completed).toBe(1);
		});
	});
});
