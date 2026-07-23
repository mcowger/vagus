import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	// 1. Add new columns to run table
	await db.schema
		.alterTable("run")
		.addColumn("kind", "text", (c) => c.notNull().defaultTo("global"))
		.execute();

	await db.schema
		.alterTable("run")
		.addColumn("profile_id", "integer")
		.execute();

	await db.schema
		.alterTable("run")
		.addColumn("input_from_article_id", "integer")
		.execute();

	await db.schema
		.alterTable("run")
		.addColumn("input_through_article_id", "integer")
		.execute();

	// 2. Rebuild interest_profile table to add schedule fields / cursor_article_id and remove legacy pacing fields
	await sql`ALTER TABLE interest_profile RENAME TO interest_profile_old`.execute(db);

	await db.schema
		.createTable("interest_profile")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("name", "text", (c) => c.notNull().defaultTo("General News"))
		.addColumn("keywords", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("topics", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("entities", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("include_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("exclude_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("profile_embedding", "blob")
		.addColumn("positive_embedding", "blob")
		.addColumn("negative_embedding", "blob")
		.addColumn("similarity_threshold", "real", (c) => c.notNull().defaultTo(0.65))
		.addColumn("max_cluster_cap", "integer", (c) => c.notNull().defaultTo(10))
		.addColumn("min_cluster_count", "integer", (c) => c.notNull().defaultTo(1))
		.addColumn("schedule_enabled", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("schedule_cron", "text", (c) => c.notNull().defaultTo("0 9 * * *"))
		.addColumn("schedule_timezone", "text", (c) =>
			c.notNull().defaultTo("America/Los_Angeles"),
		)
		.addColumn("cursor_article_id", "integer")
		.addColumn("ntfy_topic", "text")
		.addColumn("is_default", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	// 3. Migrate existing data from interest_profile_old
	await sql`
		INSERT INTO interest_profile (
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, min_cluster_count, schedule_enabled, schedule_cron, schedule_timezone,
			cursor_article_id, ntfy_topic, is_default, created_at, updated_at
		)
		SELECT
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, min_cluster_count, 0 as schedule_enabled, '0 9 * * *' as schedule_cron,
			'America/Los_Angeles' as schedule_timezone, NULL as cursor_article_id,
			ntfy_topic, is_default, created_at, updated_at
		FROM interest_profile_old
	`.execute(db);

	// 4. Drop old table
	await db.schema.dropTable("interest_profile_old").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await sql`ALTER TABLE interest_profile RENAME TO interest_profile_new`.execute(db);

	await db.schema
		.createTable("interest_profile")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("user_id", "text", (c) => c.notNull())
		.addColumn("name", "text", (c) => c.notNull().defaultTo("General News"))
		.addColumn("keywords", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("topics", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("entities", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("include_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("exclude_rules", "text", (c) => c.notNull().defaultTo("[]"))
		.addColumn("profile_embedding", "blob")
		.addColumn("positive_embedding", "blob")
		.addColumn("negative_embedding", "blob")
		.addColumn("similarity_threshold", "real", (c) => c.notNull().defaultTo(0.65))
		.addColumn("max_cluster_cap", "integer", (c) => c.notNull().defaultTo(10))
		.addColumn("min_cluster_count", "integer", (c) => c.notNull().defaultTo(1))
		.addColumn("max_digests_per_day", "integer")
		.addColumn("target_delivery_time", "text")
		.addColumn("ntfy_topic", "text")
		.addColumn("is_default", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await sql`
		INSERT INTO interest_profile (
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, min_cluster_count, max_digests_per_day, target_delivery_time,
			ntfy_topic, is_default, created_at, updated_at
		)
		SELECT
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, min_cluster_count, NULL, NULL,
			ntfy_topic, is_default, created_at, updated_at
		FROM interest_profile_new
	`.execute(db);

	await db.schema.dropTable("interest_profile_new").execute();

	await db.schema.alterTable("run").dropColumn("input_through_article_id").execute();
	await db.schema.alterTable("run").dropColumn("input_from_article_id").execute();
	await db.schema.alterTable("run").dropColumn("profile_id").execute();
	await db.schema.alterTable("run").dropColumn("kind").execute();
}
