import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("task_model")
		.addColumn("thinking_effort", "text")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("task_model")
		.dropColumn("thinking_effort")
		.execute();
}
