import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("system_setting")
		.addColumn("key", "text", (c) => c.primaryKey())
		.addColumn("value", "text", (c) => c.notNull())
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("notification_log")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("digest_id", "integer", (c) =>
			c.notNull().references("digest.id").onDelete("cascade"),
		)
		.addColumn("topic", "text", (c) => c.notNull())
		.addColumn("status", "text", (c) => c.notNull())
		.addColumn("error", "text")
		.addColumn("sent_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	// Seed default retention settings
	await (db as Kysely<any>)
		.insertInto("system_setting")
		.values([
			{ key: "article_retention_days", value: "30" },
			{ key: "digest_retention_days", value: "90" },
			{ key: "ntfy_base_url", value: "https://ntfy.sh" },
			{ key: "cron_schedule", value: "0 * * * *" },
		])
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("notification_log").execute();
	await db.schema.dropTable("system_setting").execute();
}
