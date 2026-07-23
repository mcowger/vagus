import type { Kysely } from "kysely";

const SETTING_KEYS = [
	"pipeline_article_max_age_hours",
	"pipeline_filter_feed_artifacts",
	"clustering_llm_merge_max_candidates",
];

export async function up(db: Kysely<unknown>): Promise<void> {
	await (db as Kysely<any>)
		.insertInto("system_setting")
		.values([
			{ key: "pipeline_article_max_age_hours", value: "48" },
			{ key: "pipeline_filter_feed_artifacts", value: "true" },
			{ key: "clustering_llm_merge_max_candidates", value: "12" },
		])
		.onConflict((conflict) => conflict.column("key").doNothing())
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await (db as Kysely<any>).deleteFrom("system_setting").where("key", "in", SETTING_KEYS).execute();
}
