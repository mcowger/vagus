import { type Kysely, sql } from "kysely";

// Initial app schema (M1): run coordination tables. BetterAuth and plainjob
// manage their own tables separately.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("run")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("trigger", "text", (c) => c.notNull())
		.addColumn("status", "text", (c) => c.notNull().defaultTo("running"))
		.addColumn("started_at", "text", (c) =>
			c.notNull().defaultTo(sql`(datetime('now'))`),
		)
		.addColumn("finished_at", "text")
		.addColumn("stats", "text")
		.execute();

	await db.schema
		.createTable("run_stage")
		.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
		.addColumn("run_id", "integer", (c) =>
			c.notNull().references("run.id").onDelete("cascade"),
		)
		.addColumn("stage", "text", (c) => c.notNull())
		.addColumn("expected", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("completed", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
		.execute();

	await db.schema
		.createIndex("run_stage_run_id_idx")
		.on("run_stage")
		.column("run_id")
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("run_stage").execute();
	await db.schema.dropTable("run").execute();
}
