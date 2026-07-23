import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	const database = db as Kysely<any>;

	await database.schema
		.alterTable("article")
		.addColumn("run_id", "integer", (column) => column.references("run.id").onDelete("set null"))
		.execute();

	await database
		.insertInto("system_setting")
		.values([
			{ key: "clustering_similarity_threshold", value: "0.8" },
			{ key: "clustering_llm_merge_min_similarity", value: "0.45" },
			{ key: "clustering_llm_merge_enabled", value: "true" },
		])
		.onConflict((conflict) => conflict.column("key").doNothing())
		.execute();

	await database
		.insertInto("task_model")
		.columns(["task_name", "provider", "model_name"])
		.expression((expression) =>
			expression
				.selectFrom("task_model")
				.select([
					expression.val("event_identity_merge").as("task_name"),
					"provider",
					"model_name",
				])
				.where("task_name", "=", "stage_b_synthesis"),
		)
		.onConflict((conflict) => conflict.column("task_name").doNothing())
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const database = db as Kysely<any>;
	await database.deleteFrom("task_model").where("task_name", "=", "event_identity_merge").execute();
	await database
		.deleteFrom("system_setting")
		.where("key", "in", [
			"clustering_similarity_threshold",
			"clustering_llm_merge_min_similarity",
			"clustering_llm_merge_enabled",
		])
		.execute();
	await database.schema.alterTable("article").dropColumn("run_id").execute();
}
