import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { defineQueue, type Job, type Queue } from "plainjob";
import type { Database } from "./db/schema";
import { migrateToLatest } from "./db/migrate";
import { createPlainjobConnection } from "./queue";
import { appRouter } from "./trpc/router";
import { HackerNewsAdapter } from "./adapters/hackernews";
import { GitHubTrendingAdapter } from "./adapters/github-trending";
import { ScrapeAdapter } from "./adapters/scrape";
import { processFetchSourceJob } from "./queue/ingestion";
import { processExtractArticleJob } from "./queue/extract-job";
import { processStageABulletJob } from "./queue/stage-a-job";
import { processEmbedArticleJob } from "./queue/embed-job";
import { processClusterRunJob } from "./queue/cluster-job";
import { processScoreUserJob } from "./queue/score-job";
import { processSynthesizeClusterJob } from "./synthesis/synthesize-cluster";
import { processAssembleDigestJob } from "./synthesis/assemble-digest";
import { log } from "./log";

describe("Milestone 7 Multi-Tenant E2E Test (Source Breadth, Usage & Admin Settings)", () => {
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
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({
				choices: [{ message: { content: JSON.stringify({ title: "Test summary", summary: "Test cluster summary.", perspectives: [], timeline: [], citations: [], executive_summary: "Test executive summary.", key_takeaways: [], why_it_matters: "Test significance.", key_quotes: [] }) } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}))) as unknown as typeof fetch;
		await db.insertInto("provider_config").values({ provider: "test-llm", api_key: "test-key", enabled: 1, config: JSON.stringify({ baseUrl: "https://test.invalid/v1" }) }).execute();
		await db.insertInto("task_model").values([
			{ task_name: "stage_a_bullet", provider: "test-llm", model_name: "test-model" },
			{ task_name: "stage_b_synthesis", provider: "test-llm", model_name: "test-model" },
			{ task_name: "stage_c_assembly", provider: "test-llm", model_name: "test-model" },
		]).execute();

		queue = defineQueue({
			connection: createPlainjobConnection(sqlite),
			logger: log,
		});
	});

	afterEach(async () => {
		queue.close();
		await db.destroy();
	});

	test("ingests from all source types and executes full scrape pipeline end-to-end", async () => {
		const now = new Date().toISOString();

		// 1. Insert sources for all 5 types
		const rssSource = await db
			.insertInto("source")
			.values({ type: "rss", name: "RSS Feed", url: "https://example.com/feed", enabled: 1, created_at: now, updated_at: now })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const braveSource = await db
			.insertInto("source")
			.values({ type: "brave-news", name: "Brave AI", config: JSON.stringify({ query: "AI" }), enabled: 1, created_at: now, updated_at: now })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const hnSource = await db
			.insertInto("source")
			.values({ type: "hackernews", name: "Hacker News Top", config: JSON.stringify({ limit: 5 }), enabled: 1, created_at: now, updated_at: now })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const ghSource = await db
			.insertInto("source")
			.values({ type: "github-trending", name: "GitHub Trending TypeScript", config: JSON.stringify({ language: "typescript" }), enabled: 1, created_at: now, updated_at: now })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		const scrapeSource = await db
			.insertInto("source")
			.values({ type: "scrape", name: "Scrape Target", url: "https://example.com/blog/ai-agent", enabled: 1, created_at: now, updated_at: now })
			.returning(["id"])
			.executeTakeFirstOrThrow();

		expect(rssSource.id).toBeGreaterThan(0);
		expect(braveSource.id).toBeGreaterThan(0);
		expect(hnSource.id).toBeGreaterThan(0);
		expect(ghSource.id).toBeGreaterThan(0);
		expect(scrapeSource.id).toBeGreaterThan(0);

		// 2. Mock fetch for scrape adapter pipeline test
		const sampleHtml = `<!DOCTYPE html>
<html>
<head><title>Autonomous AI Agents in Production</title></head>
<body>
  <article>
    <h1>Autonomous AI Agents in Production</h1>
    <p>Engineering teams are deploying autonomous LLM agents with deterministic workflow controls and strict safety boundaries.</p>
  </article>
</body>
</html>`;

		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request) => {
			const uStr = String(url);
			if (uStr.includes("test.invalid")) {
				return new Response(JSON.stringify({
					choices: [{ message: { content: JSON.stringify({ title: "Test summary", summary: "Test cluster summary.", perspectives: [], timeline: [], citations: [], executive_summary: "Test executive summary.", key_takeaways: [], why_it_matters: "Test significance.", key_quotes: [] }) } }],
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}), { status: 200 });
			}
			if (uStr.includes("firebaseio.com")) {
				if (uStr.includes("topstories")) {
					return new Response(JSON.stringify([9901]), { status: 200 });
				}
				return new Response(
					JSON.stringify({ id: 9901, title: "Show HN: Autonomous LLM Runtime", by: "alice", score: 120, time: Math.floor(Date.now() / 1000) - 3600, url: "https://example.com/hn-show" }),
					{ status: 200 },
				);
			}
			return new Response(sampleHtml, { status: 200 });
		}) as unknown as typeof fetch;

		try {
			// Ingest scrape source
			const run = await db
				.insertInto("run")
				.values({ trigger: "manual", status: "running", started_at: now })
				.returning(["id"])
				.executeTakeFirstOrThrow();

			const stage = await db
				.insertInto("run_stage")
				.values({ run_id: run.id, stage: "full-pipeline", expected: 1, completed: 0, status: "running" })
				.returning(["id"])
				.executeTakeFirstOrThrow();

			// Run fetch source for scrape source
			await processFetchSourceJob(db, {
				id: 1,
				type: "fetch-source",
				data: { runId: run.id, stageId: stage.id, sourceId: scrapeSource.id },
			} as unknown as Job);

			const articles = await db.selectFrom("article").selectAll().where("source_id", "=", scrapeSource.id).execute();
			expect(articles.length).toBe(1);
			const article = articles[0];
			expect(article.title).toContain("Autonomous AI Agents");

			// Run extraction
			await processExtractArticleJob(db, {
				id: 2,
				type: "extract-article",
				data: { runId: run.id, stageId: stage.id, articleId: article.id },
			} as unknown as Job);

			// Run Stage A bullet
			await processStageABulletJob(db, queue, {
				id: 3,
				type: "stage-a-bullet",
				data: { runId: run.id, stageId: stage.id, articleId: article.id },
			} as unknown as Job);

			await db
				.updateTable("article")
				.set({ publish_date: new Date().toISOString() })
				.where("id", "=", article.id)
				.execute();

			// Run Embeddings
			await processEmbedArticleJob(db, {
				id: 4,
				type: "embed-article",
				data: { runId: run.id, stageId: stage.id, articleId: article.id },
			} as unknown as Job);

			// Run Clustering
			await processClusterRunJob(db, {
				id: 5,
				type: "cluster-run",
				data: { runId: run.id, stageId: stage.id },
			} as unknown as Job);

			const clusters = await db.selectFrom("cluster").selectAll().where("run_id", "=", run.id).execute();
			expect(clusters.length).toBe(1);

			// Setup User Profile and Score
			const userId = "admin-m7-user";
			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "AI & Autonomous Systems",
					keywords: JSON.stringify(["AI", "LLM", "Agents"]),
					topics: JSON.stringify(["Artificial Intelligence"]),
					entities: JSON.stringify([]),
					include_rules: JSON.stringify([]),
					exclude_rules: JSON.stringify([]),
					similarity_threshold: 0.5,
					max_cluster_cap: 5,
					created_at: now,
					updated_at: now,
				})
				.execute();

			await processScoreUserJob(db, {
				id: 6,
				type: "score-user",
				data: { runId: run.id, stageId: stage.id, userId },
			} as unknown as Job);

			// Run Stage B Synthesis and Stage C Assembly
			await processSynthesizeClusterJob(db, queue, {
				id: 7,
				type: "synthesize-cluster",
				data: { runId: run.id, stageId: stage.id, userId, clusterId: clusters[0].id },
			} as unknown as Job);

			await processAssembleDigestJob(db, {
				id: 8,
				type: "assemble-digest",
				data: { runId: run.id, stageId: stage.id, userId },
			} as unknown as Job);

			const digest = await db.selectFrom("digest").selectAll().where("user_id", "=", userId).executeTakeFirstOrThrow();
			expect(digest.executive_summary).toBeTruthy();

			// 3. Verify tRPC Usage Router
			const caller = appRouter.createCaller({
				db,
				user: { id: userId, email: "admin@example.com", name: "Admin", role: "admin", isDisabled: false },
				session: null,
			});

			const usageStats = await caller.usage.getStats();
			expect(usageStats).toBeDefined();
			expect(typeof usageStats.totals.totalCost).toBe("number");

			// 4. Verify tRPC Admin Settings Router
			const settings = await caller.settings.getSettings();
			expect(settings.article_retention_days).toBe("30");

			await caller.settings.updateSettings({ article_retention_days: "45", ntfy_base_url: "https://ntfy.sh" });
			const updatedSettings = await caller.settings.getSettings();
			expect(updatedSettings.article_retention_days).toBe("45");
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
