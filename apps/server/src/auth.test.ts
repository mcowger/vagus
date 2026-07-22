import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAuth, initAuthSchema } from "./auth";
import { createDb, type Db } from "./db/connection";

describe("Track A Auth", () => {
	let testDb: Db;
	let dbPath: string;

	beforeEach(() => {
		dbPath = `/tmp/vagus-auth-test-${crypto.randomUUID()}.db`;
		testDb = createDb(dbPath);
	});

	afterEach(() => {
		testDb.close();
	});

	test("first signed-up user becomes admin and second user becomes user", async () => {
		const authInstance = createAuth(testDb.sqlite);
		await initAuthSchema(authInstance);

		const user1Res = await authInstance.api.signUpEmail({
			body: {
				name: "First Admin",
				email: "admin@example.com",
				password: "Password123!",
			},
		});

		expect(user1Res).toBeDefined();
		expect(user1Res.user).toBeDefined();

		const dbUser1 = testDb.sqlite
			.query("SELECT role, isDisabled FROM user WHERE email = ?")
			.get("admin@example.com") as { role: string; isDisabled: number };

		expect(dbUser1.role).toBe("admin");
		expect(Boolean(dbUser1.isDisabled)).toBe(false);

		const user2Res = await authInstance.api.signUpEmail({
			body: {
				name: "Second Regular User",
				email: "user2@example.com",
				password: "Password123!",
			},
		});

		expect(user2Res).toBeDefined();
		expect(user2Res.user).toBeDefined();

		const dbUser2 = testDb.sqlite
			.query("SELECT role, isDisabled FROM user WHERE email = ?")
			.get("user2@example.com") as { role: string; isDisabled: number };

		expect(dbUser2.role).toBe("user");
		expect(Boolean(dbUser2.isDisabled)).toBe(false);
	});

	test("a disabled user is rejected when attempting to authenticate/sign in", async () => {
		const authInstance = createAuth(testDb.sqlite);
		await initAuthSchema(authInstance);

		await authInstance.api.signUpEmail({
			body: {
				name: "Disabled User",
				email: "disabled@example.com",
				password: "Password123!",
			},
		});

		testDb.sqlite.run("UPDATE user SET isDisabled = 1 WHERE email = ?", [
			"disabled@example.com",
		]);

		expect(
			authInstance.api.signInEmail({
				body: {
					email: "disabled@example.com",
					password: "Password123!",
				},
			}),
		).rejects.toThrow();
	});

	test("email outside allowlist is rejected when SIGNUP_ALLOWED_DOMAINS is set", async () => {
		const authInstance = createAuth(testDb.sqlite, {
			allowedDomains: "allowed.com, company.org",
		});
		await initAuthSchema(authInstance);

		expect(
			authInstance.api.signUpEmail({
				body: {
					name: "Disallowed User",
					email: "user@disallowed.com",
					password: "Password123!",
				},
			}),
		).rejects.toThrow();

		const allowedUserRes = await authInstance.api.signUpEmail({
			body: {
				name: "Allowed User",
				email: "user@allowed.com",
				password: "Password123!",
			},
		});

		expect(allowedUserRes).toBeDefined();
		expect(allowedUserRes.user.email).toBe("user@allowed.com");
	});
});
