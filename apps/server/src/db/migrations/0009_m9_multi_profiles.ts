import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	// 1. Rename old interest_profile table
	await sql`ALTER TABLE interest_profile RENAME TO interest_profile_old`.execute(db);

	// 2. Create new interest_profile table without unique constraint on user_id
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
		.addColumn("ntfy_topic", "text")
		.addColumn("is_default", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	// 3. Copy data from old table
	await sql`
		INSERT INTO interest_profile (
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, ntfy_topic, is_default, created_at, updated_at
		)
		SELECT
			id, user_id, name, keywords, topics, entities, include_rules, exclude_rules,
			profile_embedding, positive_embedding, negative_embedding, similarity_threshold,
			max_cluster_cap, ntfy_topic, 1 as is_default, created_at, updated_at
		FROM interest_profile_old
	`.execute(db);

	// 4. Drop old table
	await db.schema.dropTable("interest_profile_old").execute();

	// 5. Add profile_id to user_selected_cluster and digest tables
	await db.schema
		.alterTable("user_selected_cluster")
		.addColumn("profile_id", "integer")
		.execute();

	await db.schema
		.alterTable("digest")
		.addColumn("profile_id", "integer")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.alterTable("digest").dropColumn("profile_id").execute();
	await db.schema.alterTable("user_selected_cluster").dropColumn("profile_id").execute();
	await db.schema.alterTable("interest_profile").dropColumn("is_default").execute();
}
