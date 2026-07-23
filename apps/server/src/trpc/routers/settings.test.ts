import { afterEach, beforeEach, expect, test } from "bun:test";
import { appRouter } from "../router";
import { createDb } from "../../db/connection";
import { migrateToLatest } from "../../db/migrate";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";

let dbObj: ReturnType<typeof createDb>;
let db: Kysely<Database>;

beforeEach(async () => {
	dbObj = createDb(":memory:");
	db = dbObj.kysely;
	await migrateToLatest(db);
});

afterEach(async () => {
	dbObj.close();
});

function createCaller(role: "admin" | "user" = "admin") {
	return appRouter.createCaller({
		db,
		user: {
			id: "user-1",
			email: "admin@example.com",
			name: "Admin",
			role,
			isDisabled: false,
		},
		session: null,
	});
}

test("getSettings returns default seeded settings as key-value map", async () => {
	const caller = createCaller("admin");
	const settings = await caller.settings.getSettings();

	expect(settings.article_retention_days).toBe("30");
	expect(settings.digest_retention_days).toBe("90");
	expect(settings.ntfy_base_url).toBe("https://ntfy.sh");
	expect(settings.cron_schedule).toBe("0 * * * *");
});

test("updateSettings updates retention periods, cron schedule, and ntfy endpoints", async () => {
	const caller = createCaller("admin");

	const updateRes = await caller.settings.updateSettings({
		article_retention_days: 14,
		digest_retention_days: 60,
		cron_schedule: "*/15 * * * *",
		ntfy_base_url: "https://custom-ntfy.example.com",
		app_base_url: "https://app.example.com",
	});

	expect(updateRes.success).toBe(true);

	const updatedSettings = await caller.settings.getSettings();
	expect(updatedSettings.article_retention_days).toBe("14");
	expect(updatedSettings.digest_retention_days).toBe("60");
	expect(updatedSettings.cron_schedule).toBe("*/15 * * * *");
	expect(updatedSettings.ntfy_base_url).toBe("https://custom-ntfy.example.com");
	expect(updatedSettings.app_base_url).toBe("https://app.example.com");
});

test("non-admin user is forbidden from accessing settings", async () => {
	const caller = createCaller("user");

	expect(caller.settings.getSettings()).rejects.toThrow();
	expect(
		caller.settings.updateSettings({
			article_retention_days: 7,
		}),
	).rejects.toThrow();
});

test("resetPipelineData preserves or clears Stage A based on level", async () => {
	const caller = createCaller("admin");
	const source = await db
		.insertInto("source")
		.values({ type: "rss", name: "Test Source", url: "https://example.com/rss", enabled: 1 })
		.returningAll()
		.executeTakeFirstOrThrow();
	const article = await db
		.insertInto("article")
		.values({ identity_key: "test", source_id: source.id, title: "Test", url: "https://example.com/test", content: "Test content", stage_a_bullet: "Test summary" })
		.returningAll()
		.executeTakeFirstOrThrow();
	await db
		.insertInto("article_embedding")
		.values({ article_id: article.id, embedding: new Uint8Array([1, 2, 3, 4]), model_name: "test" })
		.execute();

	await caller.settings.resetPipelineData({ level: "clustering" });
	let retained = await db.selectFrom("article").select(["stage_a_bullet"]).where("id", "=", article.id).executeTakeFirstOrThrow();
	expect(retained.stage_a_bullet).toBe("Test summary");
	expect(await db.selectFrom("article_embedding").select("id").execute()).toHaveLength(1);

	await caller.settings.resetPipelineData({ level: "stage_a" });
	retained = await db.selectFrom("article").select(["stage_a_bullet"]).where("id", "=", article.id).executeTakeFirstOrThrow();
	expect(retained.stage_a_bullet).toBeNull();
	expect(await db.selectFrom("article_embedding").select("id").execute()).toHaveLength(0);
});
