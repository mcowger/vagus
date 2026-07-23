import { describe, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { migrateToLatest } from "./db/migrate";
import type { Database } from "./db/schema";
import { FakeEmbedder } from "./embeddings/fake";
import { serializeFloat32 } from "./embeddings/types";
import { clusterRunArticles } from "./clustering";
import { scoreClustersForUser } from "./scoring";

describe("Milestone 4 — Multi-Tenant E2E Clustering & Scoring", () => {
	test("collapses related articles into a cluster and scores distinct user profiles", async () => {
		const sqlite = new BunDatabase(":memory:");
		sqlite.exec("PRAGMA foreign_keys = ON;");
		const db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});

		await migrateToLatest(db);

		const embedder = new FakeEmbedder(128);

		// 1. Create a Run
		const run = await db
			.insertInto("run")
			.values({
				trigger: "manual",
				status: "running",
				started_at: new Date().toISOString(),
				finished_at: null,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// 2. Insert dummy Source
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Tech Feed",
				url: "https://example.com/rss",
				enabled: 1,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// 3. Insert 3 Articles (2 about Space, 1 about Quantum Computing)
		const spaceArticle1 = await db
			.insertInto("article")
			.values({
				run_id: run.id,
				identity_key: "space-1",
				source_id: source.id,
				title: "NASA Space Telescope Discovers New Exoplanet",
				url: "https://example.com/space-1",
				content: "NASA astronomers discovered a super-Earth exoplanet orbiting a nearby star.",
				publish_date: new Date().toISOString(),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const spaceArticle2 = await db
			.insertInto("article")
			.values({
				run_id: run.id,
				identity_key: "space-2",
				source_id: source.id,
				title: "NASA Space Telescope Finds Earth-like Exoplanet Orbiting Distant Star",
				url: "https://example.com/space-2",
				content: "Astronomers at NASA confirmed an Earth-sized exoplanet discovery using deep space telescope imagery.",
				publish_date: new Date().toISOString(),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const quantumArticle = await db
			.insertInto("article")
			.values({
				run_id: run.id,
				identity_key: "quantum-1",
				source_id: source.id,
				title: "Breakthrough in Fault-Tolerant Quantum Computing Chips",
				url: "https://example.com/quantum-1",
				content: "Engineers successfully demonstrated a 100-qubit fault-tolerant quantum computing processor.",
				publish_date: new Date().toISOString(),
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// Embed articles
		const articles = [spaceArticle1, spaceArticle2, quantumArticle];
		const titles = [
			"NASA Space Telescope Discovers New Exoplanet",
			"NASA Space Telescope Finds Earth-like Exoplanet Orbiting Distant Star",
			"Breakthrough in Fault-Tolerant Quantum Computing Chips",
		];

		for (let i = 0; i < articles.length; i++) {
			const vec = await embedder.embedText(titles[i]);
			await db
				.insertInto("article_embedding")
				.values({
					article_id: articles[i].id,
					embedding: serializeFloat32(vec),
					model_name: embedder.getModelName(),
				})
				.execute();
		}

		// 4. Run Clustering
		await clusterRunArticles(db, run.id, { threshold: 0.55 });

		const clusters = await db
			.selectFrom("cluster")
			.selectAll()
			.where("run_id", "=", run.id)
			.execute();

		expect(clusters.length).toBe(2); // Space articles collapsed into 1 cluster, Quantum in 2nd cluster

		const clusterArticles = await db
			.selectFrom("cluster_article")
			.selectAll()
			.execute();

		expect(clusterArticles.length).toBe(3);

		// 5. Create 2 Distinct User Interest Profiles
		const spaceUserEmb = await embedder.embedText("NASA space telescope astronomy exoplanet");
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-astronomy",
				name: "Astronomy Lover",
				keywords: JSON.stringify(["NASA", "space", "exoplanet"]),
				topics: JSON.stringify(["Space Exploration"]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: serializeFloat32(spaceUserEmb),
				similarity_threshold: 0.5,
				max_cluster_cap: 1,
			})
			.execute();

		const quantumUserEmb = await embedder.embedText("quantum computing qubit chip hardware");
		await db
			.insertInto("interest_profile")
			.values({
				user_id: "user-quantum",
				name: "Quantum Tech Enthusiast",
				keywords: JSON.stringify(["quantum", "qubit"]),
				topics: JSON.stringify(["Quantum Computing"]),
				entities: JSON.stringify([]),
				include_rules: JSON.stringify([]),
				exclude_rules: JSON.stringify([]),
				profile_embedding: serializeFloat32(quantumUserEmb),
				similarity_threshold: 0.5,
				max_cluster_cap: 1,
			})
			.execute();

		// 6. Run Hybrid Scoring for both users
		await scoreClustersForUser(db, run.id, "user-astronomy");
		await scoreClustersForUser(db, run.id, "user-quantum");

		const spaceSelections = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("user_id", "=", "user-astronomy")
			.execute();

		const quantumSelections = await db
			.selectFrom("user_selected_cluster")
			.selectAll()
			.where("user_id", "=", "user-quantum")
			.execute();

		expect(spaceSelections.length).toBe(1);
		expect(quantumSelections.length).toBe(1);

		// Verify users selected different clusters!
		expect(spaceSelections[0].cluster_id).not.toBe(quantumSelections[0].cluster_id);

		// Astronomy user selected Space cluster
		const spaceSelectedCluster = clusters.find((c) => c.id === spaceSelections[0].cluster_id)!;
		expect([spaceArticle1.id, spaceArticle2.id]).toContain(spaceSelectedCluster.primary_article_id);

		// Quantum user selected Quantum cluster
		const quantumSelectedCluster = clusters.find((c) => c.id === quantumSelections[0].cluster_id)!;
		expect(quantumSelectedCluster.primary_article_id).toBe(quantumArticle.id);
	});
});
