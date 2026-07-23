import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await (db as Kysely<any>)
		.deleteFrom("task_model")
		.where("provider", "=", "faux")
		.execute();
}

export async function down(): Promise<void> {}
