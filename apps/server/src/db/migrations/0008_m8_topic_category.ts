import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("user_feedback")
		.addColumn("topic_category", "text")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("user_feedback")
		.dropColumn("topic_category")
		.execute();
}
