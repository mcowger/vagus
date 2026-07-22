import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("article_embedding")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("article_id", "integer", (c) =>
			c.notNull().unique().references("article.id").onDelete("cascade"),
		)
		.addColumn("embedding", "blob", (c) => c.notNull())
		.addColumn("model_name", "text", (c) => c.notNull())
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("cluster")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("run_id", "integer", (c) =>
			c.notNull().references("run.id").onDelete("cascade"),
		)
		.addColumn("primary_article_id", "integer", (c) =>
			c.notNull().references("article.id").onDelete("cascade"),
		)
		.addColumn("summary_title", "text")
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("cluster_article")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("cluster_id", "integer", (c) =>
			c.notNull().references("cluster.id").onDelete("cascade"),
		)
		.addColumn("article_id", "integer", (c) =>
			c.notNull().references("article.id").onDelete("cascade"),
		)
		.addColumn("is_primary", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("interest_profile")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull().unique())
		.addColumn("name", "text", (c) => c.notNull().defaultTo("Default Profile"))
		.addColumn("keywords", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("topics", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("entities", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("include_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("exclude_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("profile_embedding", "blob")
		.addColumn("similarity_threshold", "real", (c) => c.notNull().defaultTo(0.65))
		.addColumn("max_cluster_cap", "integer", (c) => c.notNull().defaultTo(10))
		.addColumn("ntfy_topic", "text")
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("user_selected_cluster")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("run_id", "integer", (c) =>
			c.notNull().references("run.id").onDelete("cascade"),
		)
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("cluster_id", "integer", (c) =>
			c.notNull().references("cluster.id").onDelete("cascade"),
		)
		.addColumn("score", "real", (c) => c.notNull())
		.addColumn("reason", "text")
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("user_selected_cluster").execute();
	await db.schema.dropTable("interest_profile").execute();
	await db.schema.dropTable("cluster_article").execute();
	await db.schema.dropTable("cluster").execute();
	await db.schema.dropTable("article_embedding").execute();
}
