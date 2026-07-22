import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../db/schema";
import { log } from "../log";

/**
 * Enforces retention policies by pruning articles and digests older than configured cutoffs.
 *
 * CRITICAL SECURITY REQUIREMENT: `processed_key` entries are NOT deleted during pruning
 * so pruned articles are not re-ingested on subsequent feed fetches.
 */
export async function pruneOldData(
	db: Kysely<Database>,
): Promise<{ prunedArticles: number; prunedDigests: number }> {
	const articleSetting = await db
		.selectFrom("system_setting")
		.select("value")
		.where("key", "=", "article_retention_days")
		.executeTakeFirst();

	const digestSetting = await db
		.selectFrom("system_setting")
		.select("value")
		.where("key", "=", "digest_retention_days")
		.executeTakeFirst();

	const parsedArticleDays = articleSetting ? parseInt(articleSetting.value, 10) : 30;
	const parsedDigestDays = digestSetting ? parseInt(digestSetting.value, 10) : 90;

	const articleRetentionDays = Number.isNaN(parsedArticleDays) ? 30 : parsedArticleDays;
	const digestRetentionDays = Number.isNaN(parsedDigestDays) ? 90 : parsedDigestDays;

	const nowMs = Date.now();
	const articleCutoffIso = new Date(nowMs - articleRetentionDays * 24 * 60 * 60 * 1000).toISOString();
	const digestCutoffIso = new Date(nowMs - digestRetentionDays * 24 * 60 * 60 * 1000).toISOString();

	return await db.transaction().execute(async (trx) => {
		// Explicitly delete article_embeddings associated with articles older than cutoff
		await trx
			.deleteFrom("article_embedding")
			.where(
				"article_id",
				"in",
				trx
					.selectFrom("article")
					.select("id")
					.where(
						sql`datetime(COALESCE(created_at, fetched_at))`,
						"<",
						sql`datetime(${articleCutoffIso})`,
					),
			)
			.execute();

		// Delete articles older than articleRetentionDays cutoff
		const articleDeleteResult = await trx
			.deleteFrom("article")
			.where(
				sql`datetime(COALESCE(created_at, fetched_at))`,
				"<",
				sql`datetime(${articleCutoffIso})`,
			)
			.executeTakeFirst();

		const prunedArticles = Number(articleDeleteResult.numDeletedRows ?? 0);

		// Delete citations associated with digests older than cutoff
		await trx
			.deleteFrom("citation")
			.where(
				"digest_id",
				"in",
				trx
					.selectFrom("digest")
					.select("id")
					.where(sql`datetime(created_at)`, "<", sql`datetime(${digestCutoffIso})`),
			)
			.execute();

		// Delete digest_clusters associated with digests older than cutoff
		await trx
			.deleteFrom("digest_cluster")
			.where(
				"digest_id",
				"in",
				trx
					.selectFrom("digest")
					.select("id")
					.where(sql`datetime(created_at)`, "<", sql`datetime(${digestCutoffIso})`),
			)
			.execute();

		// Delete digests older than digestRetentionDays cutoff
		const digestDeleteResult = await trx
			.deleteFrom("digest")
			.where(sql`datetime(created_at)`, "<", sql`datetime(${digestCutoffIso})`)
			.executeTakeFirst();

		const prunedDigests = Number(digestDeleteResult.numDeletedRows ?? 0);

		log.info("Completed retention pruning", {
			articleRetentionDays,
			digestRetentionDays,
			prunedArticles,
			prunedDigests,
		});

		return {
			prunedArticles,
			prunedDigests,
		};
	});
}
