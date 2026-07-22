import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("provider_config")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("provider", "text", (c) => c.notNull().unique())
		.addColumn("api_key", "text")
		.addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
		.addColumn("config", "text")
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("source")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("type", "text", (c) => c.notNull())
		.addColumn("name", "text", (c) => c.notNull())
		.addColumn("url", "text")
		.addColumn("config", "text")
		.addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
		.addColumn("owner_user_id", "text")
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("processed_key")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("identity_key", "text", (c) => c.notNull().unique())
		.addColumn("source_id", "integer", (c) =>
			c.notNull().references("source.id").onDelete("cascade"),
		)
		.addColumn("processed_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createIndex("processed_key_identity_idx")
		.on("processed_key")
		.column("identity_key")
		.execute();

	await db.schema
		.createTable("article")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("identity_key", "text", (c) => c.notNull().unique())
		.addColumn("source_id", "integer", (c) =>
			c.notNull().references("source.id").onDelete("cascade"),
		)
		.addColumn("title", "text", (c) => c.notNull())
		.addColumn("url", "text", (c) => c.notNull())
		.addColumn("author", "text")
		.addColumn("content", "text")
		.addColumn("publish_date", "text")
		.addColumn("image_url", "text")
		.addColumn("reading_time_minutes", "integer")
		.addColumn("stage_a_bullet", "text")
		.addColumn("fetched_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createIndex("article_identity_idx")
		.on("article")
		.column("identity_key")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("article").execute();
	await db.schema.dropTable("processed_key").execute();
	await db.schema.dropTable("source").execute();
	await db.schema.dropTable("provider_config").execute();
}
