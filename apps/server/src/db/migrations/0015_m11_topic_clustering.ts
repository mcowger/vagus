import type { Kysely } from "kysely";

const SETTING_KEYS = [
	"clustering_topic_min_frequency",
	"clustering_topic_subcluster_threshold",
	"clustering_topic_validation_max_buckets",
];

export async function up(db: Kysely<unknown>): Promise<void> {
	await (db as Kysely<any>)
		.insertInto("system_setting")
		.values([
			{ key: "clustering_topic_min_frequency", value: "3" },
			{ key: "clustering_topic_subcluster_threshold", value: "0.65" },
			{ key: "clustering_topic_validation_max_buckets", value: "20" },
		])
		.onConflict((conflict) => conflict.column("key").doNothing())
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await (db as Kysely<any>).deleteFrom("system_setting").where("key", "in", SETTING_KEYS).execute();
}
