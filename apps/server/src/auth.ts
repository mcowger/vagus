import type { Database as BunDatabase } from "bun:sqlite";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { config } from "./config";
import { db as defaultDb } from "./db/connection";

export interface CreateAuthOptions {
	secret?: string;
	allowedDomains?: string;
	baseURL?: string;
}

export async function initAuthSchema(authInstance: AuthInstance) {
	try {
		const { runMigrations } = await getMigrations(authInstance.options);
		await runMigrations();
	} catch (err) {
		const msg = String(err);
		if (!msg.includes("already exists")) {
			throw err;
		}
	}
}

export function createAuth(
	sqlite: BunDatabase,
	options: CreateAuthOptions = {},
) {
	const secret = options.secret ?? config.betterAuthSecret;
	const allowedDomainsSetting =
		options.allowedDomains ?? process.env.SIGNUP_ALLOWED_DOMAINS ?? "";

	const authInstance = betterAuth({
		database: {
			dialect: new BunSqliteDialect({ database: sqlite }),
			type: "sqlite",
		},
		secret,
		baseURL:
			options.baseURL ??
			process.env.BETTER_AUTH_URL ??
			`http://localhost:${config.port}`,
		emailAndPassword: {
			enabled: true,
		},
		plugins: [apiKey() as any],
		user: {
			additionalFields: {
				role: {
					type: "string",
					required: false,
					defaultValue: "user",
				},
				isDisabled: {
					type: "boolean",
					required: false,
					defaultValue: false,
				},
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const allowedDomains = allowedDomainsSetting
							.split(",")
							.map((d) => d.trim().toLowerCase())
							.filter(Boolean);

						if (allowedDomains.length > 0 && user.email) {
							const userDomain = user.email.split("@")[1]?.toLowerCase();
							if (!userDomain || !allowedDomains.includes(userDomain)) {
								throw new APIError("BAD_REQUEST", {
									message: "Email domain not allowed",
								});
							}
						}

						let count = 0;
						try {
							const row = sqlite
								.query("SELECT COUNT(*) as count FROM user")
								.get() as { count: number | bigint } | null;
							count = row ? Number(row.count) : 0;
						} catch {
							count = 0;
						}

						const role = count === 0 ? "admin" : "user";

						return {
							data: {
								...user,
								role,
								isDisabled: false,
							},
						};
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						try {
							const userRow = sqlite
								.query("SELECT isDisabled FROM user WHERE id = ?")
								.get(session.userId) as { isDisabled: number | boolean } | null;
							if (userRow && Boolean(userRow.isDisabled)) {
								throw new APIError("FORBIDDEN", {
									message: "User account is disabled",
								});
							}
						} catch (err) {
							if (err instanceof APIError) throw err;
						}
					},
				},
			},
		},
	});

	// Schema migration is run deterministically on boot by index.ts (and by
	// tests) via initAuthSchema — not fire-and-forget here.
	return authInstance;
}

export type AuthInstance = ReturnType<typeof createAuth>;

export const auth = createAuth(defaultDb.sqlite);
