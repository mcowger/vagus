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
