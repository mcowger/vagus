import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("task_model")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("task_name", "text", (c) => c.notNull().unique())
		.addColumn("provider", "text", (c) => c.notNull())
		.addColumn("model_name", "text", (c) => c.notNull())
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("updated_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

	await db.schema
		.createTable("llm_usage")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("run_id", "integer", (c) =>
			c.references("run.id").onDelete("set null"),
		)
		.addColumn("task_name", "text", (c) => c.notNull())
		.addColumn("provider", "text", (c) => c.notNull())
		.addColumn("model_name", "text", (c) => c.notNull())
		.addColumn("prompt_tokens", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("completion_tokens", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("estimated_cost", "real", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.execute();

}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("llm_usage").execute();
	await db.schema.dropTable("task_model").execute();
}
