import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("interest_profile")
		.addColumn("max_digests_per_day", "integer")
		.execute();

	await db.schema
		.alterTable("interest_profile")
		.addColumn("target_delivery_time", "text")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("interest_profile")
		.dropColumn("target_delivery_time")
		.execute();

	await db.schema
		.alterTable("interest_profile")
		.dropColumn("max_digests_per_day")
		.execute();
}
