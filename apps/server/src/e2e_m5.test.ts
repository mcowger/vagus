import { describe, expect, test } from "bun:test";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import type { Database } from "./db/schema";
import { migrateToLatest } from "./db/migrate";
import { processSynthesizeClusterJob } from "./synthesis/synthesize-cluster";
import { processAssembleDigestJob } from "./synthesis/assemble-digest";
import { createPlainjobConnection } from "./queue";
import { defineQueue, type Queue, type Job } from "plainjob";
import { log } from "./log";

async function createTestDb(): Promise<{ db: Kysely<Database>; sqlite: BunSqliteDatabase }> {
	const sqlite = new BunSqliteDatabase(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");

	const db = new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite }),
	});

	await migrateToLatest(db);
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({
			choices: [{ message: { content: JSON.stringify({ title: "Test summary", summary: "Test cluster summary.", perspectives: [], timeline: [], citations: [], executive_summary: "Test executive summary.", key_takeaways: [], why_it_matters: "Test significance.", key_quotes: [] }) } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		}))) as unknown as typeof fetch;
	await db.insertInto("provider_config").values({ provider: "test-llm", api_key: "test-key", enabled: 1, config: JSON.stringify({ baseUrl: "https://test.invalid/v1" }) }).execute();
	await db.insertInto("task_model").values([
		{ task_name: "stage_b_synthesis", provider: "test-llm", model_name: "test-model" },
		{ task_name: "stage_c_assembly", provider: "test-llm", model_name: "test-model" },
	]).execute();

	return { db, sqlite };
}

describe("Milestone 5 Multi-Tenant E2E Test (Synthesis, Digests & Citations)", () => {
	test("generates grounded, cited digests for multiple users with different interest profiles", async () => {
		const { db, sqlite } = await createTestDb();

		const queue: Queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
			logger: log,
		});

		// 1. Setup Source and Articles
		const now = new Date().toISOString();
		const source = await db
			.insertInto("source")
			.values({
				type: "rss",
				name: "Space & Physics Weekly",
				url: "https://example.com/feed.xml",
				enabled: 1,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const art1 = await db
			.insertInto("article")
			.values({
				identity_key: "key-art-1",
				source_id: source.id,
				title: "James Webb Telescope Discovers Exoplanet Atmosphere",
				url: "https://example.com/webb-exoplanet",
				content: "NASA's James Webb Space Telescope detected water vapor on distant exoplanet WASP-96b.",
				stage_a_bullet: "JWST discovers water vapor in exoplanet atmosphere.",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const art2 = await db
			.insertInto("article")
			.values({
				identity_key: "key-art-2",
				source_id: source.id,
				title: "Hubble and Webb Joint Observations Confirm Cosmic Expansion",
				url: "https://example.com/cosmic-expansion",
				content: "Joint observations from Hubble and Webb space telescopes refine measurement of Hubble constant.",
				stage_a_bullet: "Telescopes confirm cosmic expansion measurement.",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const art3 = await db
			.insertInto("article")
			.values({
				identity_key: "key-art-3",
				source_id: source.id,
				title: "Quantum Computer Achieves 1000 Qubit Milestone",
				url: "https://example.com/quantum-1000",
				content: "Tech researchers announce a fault-tolerant quantum processing unit operating 1000 qubits.",
				stage_a_bullet: "Researchers demonstrate 1000 qubit quantum processor.",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// 2. Setup Run and Clusters
		const run = await db
			.insertInto("run")
			.values({
				trigger: "manual",
				status: "running",
				started_at: now,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const stage = await db
			.insertInto("run_stage")
			.values({
				run_id: run.id,
				stage: "synthesis",
				expected: 2,
				completed: 0,
				status: "running",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		// Cluster 1: Astronomy / Telescopes (art1, art2)
		const clusterSpace = await db
			.insertInto("cluster")
			.values({
				run_id: run.id,
				primary_article_id: art1.id,
				summary_title: "Space Telescope Discoveries",
				created_at: now,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: clusterSpace.id, article_id: art1.id, is_primary: 1, created_at: now })
			.execute();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: clusterSpace.id, article_id: art2.id, is_primary: 0, created_at: now })
			.execute();

		// Cluster 2: Quantum Computing (art3)
		const clusterQuantum = await db
			.insertInto("cluster")
			.values({
				run_id: run.id,
				primary_article_id: art3.id,
				summary_title: "Quantum Processor Breakthrough",
				created_at: now,
			})
			.returning(["id"])
			.executeTakeFirstOrThrow();

		await db
			.insertInto("cluster_article")
			.values({ cluster_id: clusterQuantum.id, article_id: art3.id, is_primary: 1, created_at: now })
			.execute();

		// 3. User 1: Space enthusiast selected clusterSpace
		const userSpaceId = "user-space-explorer";
		await db
			.insertInto("user_selected_cluster")
			.values({
				run_id: run.id,
				user_id: userSpaceId,
				cluster_id: clusterSpace.id,
				score: 0.92,
				reason: "High interest in astronomy and telescopes",
			})
			.execute();

		// User 2: Quantum enthusiast selected clusterQuantum
		const userQuantumId = "user-quantum-dev";
		await db
			.insertInto("user_selected_cluster")
			.values({
				run_id: run.id,
				user_id: userQuantumId,
				cluster_id: clusterQuantum.id,
				score: 0.88,
				reason: "High interest in quantum computing",
			})
			.execute();

		// 4. Run Stage B Synthesis for User 1 & Cluster Space
		await processSynthesizeClusterJob(db, queue, {
			id: 1,
			type: "synthesize-cluster",
			data: { runId: run.id, stageId: stage.id, userId: userSpaceId, clusterId: clusterSpace.id },
		} as unknown as Job);

		// Run Stage B Synthesis for User 2 & Cluster Quantum
		await processSynthesizeClusterJob(db, queue, {
			id: 2,
			type: "synthesize-cluster",
			data: { runId: run.id, stageId: stage.id, userId: userQuantumId, clusterId: clusterQuantum.id },
		} as unknown as Job);

		// 5. Run Stage C Assembly for both users
		await processAssembleDigestJob(db, {
			id: 3,
			type: "assemble-digest",
			data: { runId: run.id, stageId: stage.id, userId: userSpaceId },
		} as unknown as Job);

		await processAssembleDigestJob(db, {
			id: 4,
			type: "assemble-digest",
			data: { runId: run.id, stageId: stage.id, userId: userQuantumId },
		} as unknown as Job);

		// 6. Assert Digest 1 (User Space)
		const digestSpace = await db
			.selectFrom("digest")
			.selectAll()
			.where("user_id", "=", userSpaceId)
			.executeTakeFirstOrThrow();

		expect(digestSpace.executive_summary).toBeTruthy();
		expect(digestSpace.why_it_matters).toBeTruthy();

		const clustersSpace = await db
			.selectFrom("digest_cluster")
			.selectAll()
			.where("digest_id", "=", digestSpace.id)
			.execute();

		expect(clustersSpace.length).toBe(1);
		expect(clustersSpace[0].cluster_id).toBe(clusterSpace.id);

		const citationsSpace = await db
			.selectFrom("citation")
			.selectAll()
			.where("digest_id", "=", digestSpace.id)
			.execute();

		expect(citationsSpace.length).toBeGreaterThan(0);
		const citationKeysSpace = citationsSpace.map((c) => c.citation_key);
		expect(citationKeysSpace).toContain(`art_${art1.id}`);

		// 7. Assert Digest 2 (User Quantum)
		const digestQuantum = await db
			.selectFrom("digest")
			.selectAll()
			.where("user_id", "=", userQuantumId)
			.executeTakeFirstOrThrow();

		expect(digestQuantum.executive_summary).toBeTruthy();

		const clustersQuantum = await db
			.selectFrom("digest_cluster")
			.selectAll()
			.where("digest_id", "=", digestQuantum.id)
			.execute();

		expect(clustersQuantum.length).toBe(1);
		expect(clustersQuantum[0].cluster_id).toBe(clusterQuantum.id);

		const citationsQuantum = await db
			.selectFrom("citation")
			.selectAll()
			.where("digest_id", "=", digestQuantum.id)
			.execute();

		expect(citationsQuantum.length).toBeGreaterThan(0);
		const citationKeysQuantum = citationsQuantum.map((c) => c.citation_key);
		expect(citationKeysQuantum).toContain(`art_${art3.id}`);

		// Clean close
		queue.close();
		await db.destroy();
	});
});
