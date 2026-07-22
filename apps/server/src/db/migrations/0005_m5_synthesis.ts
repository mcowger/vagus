import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("digest")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("run_id", "integer", (c) =>
			c.notNull().references("run.id").onDelete("cascade"),
		)
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("executive_summary", "text", (c) => c.notNull())
		.addColumn("key_takeaways", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("why_it_matters", "text", (c) => c.notNull())
		.addColumn("key_quotes", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("digest_cluster")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("digest_id", "integer", (c) =>
			c.notNull().references("digest.id").onDelete("cascade"),
		)
		.addColumn("cluster_id", "integer", (c) =>
			c.notNull().references("cluster.id").onDelete("cascade"),
		)
		.addColumn("title", "text", (c) => c.notNull())
		.addColumn("summary", "text", (c) => c.notNull())
		.addColumn("perspectives", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("timeline", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("citation")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("digest_id", "integer", (c) =>
			c.notNull().references("digest.id").onDelete("cascade"),
		)
		.addColumn("digest_cluster_id", "integer", (c) =>
			c.references("digest_cluster.id").onDelete("cascade"),
		)
		.addColumn("article_id", "integer", (c) =>
			c.notNull().references("article.id").onDelete("cascade"),
		)
		.addColumn("citation_key", "text", (c) => c.notNull())
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("citation").execute();
	await db.schema.dropTable("digest_cluster").execute();
	await db.schema.dropTable("digest").execute();
}
