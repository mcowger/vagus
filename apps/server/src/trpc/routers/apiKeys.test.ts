import { afterEach, beforeEach, expect, test } from "bun:test";
import { sql } from "kysely";
import { createAuth, initAuthSchema } from "../../auth";
import { createDb, type Db } from "../../db/connection";
import { migrateToLatest } from "../../db/migrate";
import { appRouter } from "../router";

let dbObj: Db;
let authInstance: ReturnType<typeof createAuth>;

const ADMIN_ID = "admin-1";

beforeEach(async () => {
	dbObj = createDb(":memory:");
	await migrateToLatest(dbObj.kysely);
	authInstance = createAuth(dbObj.sqlite);
	await initAuthSchema(authInstance);
	const now = new Date().toISOString();
	dbObj.sqlite.run(
		"INSERT INTO user (id,email,name,role,isDisabled,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)",
		[ADMIN_ID, "admin@example.com", "Admin", "admin", 0, 1, now, now],
	);
});

afterEach(() => {
	dbObj.close();
});

function createCaller(role: "admin" | "user" = "admin", id = ADMIN_ID) {
	return appRouter.createCaller({
		db: dbObj.kysely,
		user: {
			id,
			email: "admin@example.com",
			name: "Admin",
			role,
			isDisabled: false,
		},
		session: null,
	});
}

// Mirror what the router's `create` does, but against the test-scoped auth
// instance (the router delegates to the module singleton, which is bound to a
// different DB in tests).
async function seedKey(name: string) {
	const created = await (authInstance.api as any).createApiKey({
		body: { name, userId: ADMIN_ID },
	});
	return created;
}

test("createApiKey returns a raw key owned by the admin", async () => {
	const created = await seedKey("robot-1");
	expect(created.id).toBeString();
	expect(created.key).toBeString();
	expect(created.key.length).toBeGreaterThan(10);

	const row = dbObj.sqlite
		.query("SELECT referenceId FROM apikey WHERE id = ?")
		.get(created.id) as { referenceId: string };
	expect(row.referenceId).toBe(ADMIN_ID);
});

test("list returns keys without the raw secret", async () => {
	const created = await seedKey("robot-2");
	const caller = createCaller("admin");
	const keys = await caller.apiKeys.list();

	expect(keys).toHaveLength(1);
	expect(keys[0].id).toBe(created.id);
	expect(keys[0].name).toBe("robot-2");
	expect(keys[0].enabled).toBe(true);
	expect(Object.keys(keys[0])).not.toContain("key");
});

test("revoke deletes the key", async () => {
	const created = await seedKey("robot-3");
	const caller = createCaller("admin");

	const res = await caller.apiKeys.revoke({ keyId: created.id });
	expect(res.success).toBe(true);

	const remaining = await sql<{ c: number }>`SELECT COUNT(*) as c FROM apikey`.execute(
		dbObj.kysely,
	);
	expect(Number(remaining.rows[0].c)).toBe(0);
});

test("non-admin callers are rejected", async () => {
	const caller = createCaller("user", "user-9");
	await expect(caller.apiKeys.list()).rejects.toThrow();
	await expect(caller.apiKeys.create({ name: "x" })).rejects.toThrow();
	await expect(caller.apiKeys.revoke({ keyId: "x" })).rejects.toThrow();
});
