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

test("0016 migration adds run kind and interest_profile schedule fields", async () => {
	const db = createDb(":memory:");
	await migrateToLatest(db.kysely);

	const runCols = db.sqlite
		.query("PRAGMA table_info(run);")
		.all() as { name: string }[];
	const runColNames = runCols.map((c) => c.name);

	expect(runColNames).toContain("kind");
	expect(runColNames).toContain("profile_id");
	expect(runColNames).toContain("input_from_article_id");
	expect(runColNames).toContain("input_through_article_id");

	const profileCols = db.sqlite
		.query("PRAGMA table_info(interest_profile);")
		.all() as { name: string }[];
	const profileColNames = profileCols.map((c) => c.name);

	expect(profileColNames).toContain("schedule_enabled");
	expect(profileColNames).toContain("schedule_cron");
	expect(profileColNames).toContain("schedule_timezone");
	expect(profileColNames).toContain("cursor_article_id");
	expect(profileColNames).not.toContain("max_digests_per_day");
	expect(profileColNames).not.toContain("target_delivery_time");

	// Insert default interest profile and check default values
	await db.kysely
		.insertInto("interest_profile")
		.values({
			user_id: "u-mig-test",
			name: "Test Profile",
		})
		.execute();

	const prof = await db.kysely
		.selectFrom("interest_profile")
		.selectAll()
		.where("user_id", "=", "u-mig-test")
		.executeTakeFirstOrThrow();

	expect(prof.schedule_enabled).toBe(0);
	expect(prof.schedule_cron).toBe("0 9 * * *");
	expect(prof.schedule_timezone).toBe("America/Los_Angeles");
	expect(prof.cursor_article_id).toBeNull();

	// Insert default run and check default kind
	await db.kysely
		.insertInto("run")
		.values({
			trigger: "manual",
			status: "running",
			started_at: new Date().toISOString(),
		})
		.execute();

	const runRow = await db.kysely
		.selectFrom("run")
		.selectAll()
		.executeTakeFirstOrThrow();

	expect(runRow.kind).toBe("global");
	expect(runRow.profile_id).toBeNull();

	db.close();
});
