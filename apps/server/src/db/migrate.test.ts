import { expect, test } from "bun:test";
import { createDb } from "./connection";
import { migrateToLatest } from "./migrate";

test("migrateToLatest creates the app tables on a fresh DB", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);

	const tables = db.sqlite
		.query("SELECT name FROM sqlite_master WHERE type = 'table';")
		.all() as { name: string }[];
	const names = tables.map((t) => t.name);

	expect(names).toContain("run");
	expect(names).toContain("run_stage");
	db.close();
});

test("migrateToLatest is idempotent", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);
	await migrateToLatest(db.kysely); // second run should not throw
	db.close();
});
