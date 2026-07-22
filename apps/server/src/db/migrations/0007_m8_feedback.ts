import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("user_feedback")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("target_type", "text", (c) => c.notNull()) // "source" | "cluster"
		.addColumn("target_id", "text", (c) => c.notNull())
		.addColumn("vote", "integer", (c) => c.notNull()) // 1 = thumbs_up, -1 = thumbs_down, 0 = neutral
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createIndex("user_feedback_user_target_idx")
		.on("user_feedback")
		.columns(["user_id", "target_type", "target_id"])
		.unique()
		.execute();

	await db.schema
		.createTable("user_source_weight")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("source_id", "integer", (c) =>
			c.notNull().references("source.id").onDelete("cascade"),
		)
		.addColumn("weight", "real", (c) => c.notNull().defaultTo(1.0))
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createIndex("user_source_weight_user_source_idx")
		.on("user_source_weight")
		.columns(["user_id", "source_id"])
		.unique()
		.execute();

	await db.schema
		.alterTable("interest_profile")
		.addColumn("positive_embedding", "blob")
		.execute();

	await db.schema
		.alterTable("interest_profile")
		.addColumn("negative_embedding", "blob")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.alterTable("interest_profile").dropColumn("negative_embedding").execute();
	await db.schema.alterTable("interest_profile").dropColumn("positive_embedding").execute();
	await db.schema.dropTable("user_source_weight").execute();
	await db.schema.dropTable("user_feedback").execute();
}
