import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { BraveNewsAdapter } from "../adapters/brave-news";
import { GitHubTrendingAdapter } from "../adapters/github-trending";
import { HackerNewsAdapter } from "../adapters/hackernews";
import { RssAdapter } from "../adapters/rss";
import { ScrapeAdapter } from "../adapters/scrape";
import type { SourceAdapter } from "../adapters/types";
import type { Database } from "../db/schema";
import { log } from "../log";
import { advanceStage } from "./coordinator";

export const FETCH_SOURCE_JOB_TYPE = "fetch-source";

export interface FetchSourceJobData {
	runId: number;
	stageId: number;
	sourceId: number;
}

const adapters: Record<string, SourceAdapter> = {
	rss: new RssAdapter(),
	"brave-news": new BraveNewsAdapter(),
	hackernews: new HackerNewsAdapter(),
	hn: new HackerNewsAdapter(),
	"github-trending": new GitHubTrendingAdapter(),
	scrape: new ScrapeAdapter(),
};

export async function processFetchSourceJob(
	db: Kysely<Database>,
	job: Job,
): Promise<void> {
	let data: FetchSourceJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as FetchSourceJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as FetchSourceJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, sourceId } = data;

	log.info("Starting fetch-source job", { jobId: job.id, sourceId, runId });

	try {
		const source = await db
			.selectFrom("source")
			.selectAll()
			.where("id", "=", sourceId)
			.executeTakeFirst();

		if (!source || source.enabled !== 1) {
			log.warn("Source not found or disabled, skipping fetch", { sourceId });
			return;
		}

		const adapter = adapters[source.type];
		if (!adapter) {
			log.error(`No adapter found for source type: ${source.type}`, { sourceId });
			return;
		}

		let apiKey: string | undefined;
		if (source.type === "brave-news") {
			const providerConf = await db
				.selectFrom("provider_config")
				.selectAll()
				.where("provider", "=", "brave-news")
				.where("enabled", "=", 1)
				.executeTakeFirst();
			apiKey = providerConf?.api_key || undefined;
		}

		const items = await adapter.fetchItems(source, { apiKey });
		log.info(`Fetched ${items.length} raw items from source`, { sourceId, count: items.length });

		let ingestedCount = 0;

		for (const item of items) {
			// Idempotency check via processed_key table (FR-5 - FR-8)
			const existingKey = await db
				.selectFrom("processed_key")
				.select("id")
				.where("identity_key", "=", item.identityKey)
				.executeTakeFirst();

			if (existingKey) {
				log.debug("Skipping already processed item", { identityKey: item.identityKey });
				continue;
			}

			// Cold-start reconciliation: also check if article already exists
			const existingArticle = await db
				.selectFrom("article")
				.select("id")
				.where("identity_key", "=", item.identityKey)
				.executeTakeFirst();

			if (existingArticle) {
				// Record processed_key if missing
				await db
					.insertInto("processed_key")
					.values({
						identity_key: item.identityKey,
						source_id: sourceId,
					})
					.onConflict((oc) => oc.doNothing())
					.execute();
				continue;
			}

			// Insert into processed_key and article in transaction
			await db.transaction().execute(async (trx) => {
				await trx
					.insertInto("processed_key")
					.values({
						identity_key: item.identityKey,
						source_id: sourceId,
					})
					.onConflict((oc) => oc.doNothing())
					.execute();

				await trx
					.insertInto("article")
					.values({
						run_id: runId,
						identity_key: item.identityKey,
						source_id: sourceId,
						title: item.title,
						url: item.url,
						author: item.author ?? null,
						content: item.content ?? null,
						publish_date: item.publishDate ?? null,
						image_url: item.imageUrl ?? null,
					})
					.onConflict((oc) => oc.doNothing())
					.execute();
			});

			ingestedCount++;
		}

		log.info("Ingested new items for source", { sourceId, newItems: ingestedCount });
	} catch (err) {
		// FR-8: One failing source doesn't fail the entire run. Log error and continue.
		log.error("Failed to fetch source", { sourceId, error: String(err) });
	} finally {
		await advanceStage(db, stageId, job.id);
	}
}
