import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("interest_profile")
		.addColumn("min_cluster_count", "integer", (c) => c.notNull().defaultTo(1))
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("interest_profile")
		.dropColumn("min_cluster_count")
		.execute();
}
