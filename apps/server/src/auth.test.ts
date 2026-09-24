import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAuth, initAuthSchema, resolveSignupRole } from "./auth";
import { createDb, type Db } from "./db/connection";

describe("resolveSignupRole", () => {
	test("admin email becomes admin and bypasses the domain whitelist", () => {
		const role = resolveSignupRole(
			"boss@gmail.com",
			"allowed.com",
			"boss@gmail.com",
		);
		expect(role).toBe("admin");
	});

	test("admin match is case-insensitive", () => {
		const role = resolveSignupRole(
			"Boss@Gmail.com",
			"allowed.com",
			"boss@gmail.com",
		);
		expect(role).toBe("admin");
	});

	test("non-admin email on a whitelisted domain becomes user", () => {
		const role = resolveSignupRole("jane@allowed.com", "allowed.com", "");
		expect(role).toBe("user");
	});

	test("non-admin email off the whitelist is rejected", () => {
		expect(() =>
			resolveSignupRole("jane@disallowed.com", "allowed.com", ""),
		).toThrow();
	});

	test("empty whitelist allows any non-admin domain", () => {
		const role = resolveSignupRole("jane@anywhere.com", "", "");
		expect(role).toBe("user");
	});

	test("whitelist accepts comma/space separated domains", () => {
		expect(
			resolveSignupRole("x@company.org", "allowed.com, company.org", ""),
		).toBe("user");
	});
});

describe("Auth instance", () => {
	let testDb: Db;
	let dbPath: string;

	beforeEach(() => {
		dbPath = `/tmp/vagus-auth-test-${crypto.randomUUID()}.db`;
		testDb = createDb(dbPath);
	});

	afterEach(() => {
		testDb.close();
	});

	test("email/password sign-up is disabled", async () => {
		const authInstance = createAuth(testDb.sqlite);
		await initAuthSchema(authInstance);

		await expect(
			authInstance.api.signUpEmail({
				body: {
					name: "Nobody",
					email: "nobody@example.com",
					password: "Password123!",
				},
			}),
		).rejects.toThrow();
	});

	test("auth migrations preserve existing account rows without an issuer column", async () => {
		testDb.sqlite.exec(`
			CREATE TABLE account (
				id TEXT PRIMARY KEY NOT NULL,
				accountId TEXT NOT NULL,
				providerId TEXT NOT NULL,
				userId TEXT NOT NULL,
				accessToken TEXT,
				refreshToken TEXT,
				idToken TEXT,
				accessTokenExpiresAt date,
				refreshTokenExpiresAt date,
				scope TEXT,
				password TEXT,
				createdAt date NOT NULL,
				updatedAt date NOT NULL
			)
		`);
		testDb.sqlite
			.query(
				`INSERT INTO account
					(id, accountId, providerId, userId, createdAt, updatedAt)
					VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"account-1",
				"google-account-1",
				"google",
				"user-1",
				new Date().toISOString(),
				new Date().toISOString(),
			);

		const authInstance = createAuth(testDb.sqlite);
		await initAuthSchema(authInstance);

		const account = testDb.sqlite
			.query("SELECT id, providerId FROM account WHERE id = ?")
			.get("account-1") as { id: string; providerId: string } | null;
		const accountColumns = testDb.sqlite
			.query("PRAGMA table_info(account)")
			.all() as { name: string }[];

		expect(account).toEqual({ id: "account-1", providerId: "google" });
		expect(accountColumns.map(({ name }) => name)).not.toContain("issuer");
	});

	test("Google provider is registered only when both creds are present", () => {
		const withCreds = createAuth(testDb.sqlite, {
			googleClientId: "id",
			googleClientSecret: "secret",
		});
		expect(withCreds.options.socialProviders?.google).toBeDefined();

		const withoutCreds = createAuth(testDb.sqlite, {
			googleClientId: "id",
		});
		expect(withoutCreds.options.socialProviders?.google).toBeUndefined();
	});
});
