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
	adminEmails?: string;
	baseURL?: string;
	googleClientId?: string;
	googleClientSecret?: string;
}

/**
 * Single source of truth for signup authorization. Applied on user creation
 * for both real Google logins and the dev-only /dev/login endpoint.
 *
 * Rules:
 *  - admin emails (ADMIN_EMAILS) are always allowed and become admin, bypassing
 *    the domain whitelist;
 *  - otherwise the email domain must match SIGNUP_ALLOWED_DOMAINS (when set).
 *
 * Returns the resolved role, or throws BAD_REQUEST when the email is not allowed.
 */
export function resolveSignupRole(
	email: string | undefined,
	allowedDomainsSetting: string,
	adminEmailsSetting: string,
): "admin" | "user" {
	const adminEmails = adminEmailsSetting
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	const normalizedEmail = email?.toLowerCase();

	if (normalizedEmail && adminEmails.includes(normalizedEmail)) {
		return "admin";
	}

	const allowedDomains = allowedDomainsSetting
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);

	if (allowedDomains.length > 0) {
		const userDomain = normalizedEmail?.split("@")[1];
		if (!userDomain || !allowedDomains.includes(userDomain)) {
			throw new APIError("BAD_REQUEST", {
				message: "Email domain not allowed",
			});
		}
	}

	return "user";
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
	const adminEmailsSetting =
		options.adminEmails ?? process.env.ADMIN_EMAILS ?? "";
	const googleClientId =
		options.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
	const googleClientSecret =
		options.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
	const isHttps = (process.env.BETTER_AUTH_URL || "").startsWith("https");

	// Google is the only human login path; register it only when both creds are
	// present so local dev/tests without Google creds still boot.
	const socialProviders =
		googleClientId && googleClientSecret
			? {
					google: {
						clientId: googleClientId,
						clientSecret: googleClientSecret,
					},
				}
			: undefined;

	const authInstance = betterAuth({
		trustedOrigins: ["*"],
		advanced: {
			useSecureCookies: isHttps,
		},
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
			enabled: false,
		},
		socialProviders,
		// Google verifies email ownership, so allow a Google sign-in to link into an
		// existing account with the same email (e.g. accounts predating the switch
		// away from email/password). Without this better-auth throws
		// `account_not_linked`.
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google"],
			},
		},
		// enableSessionForAPIKeys lets robots authenticate by sending the key in the
		// `x-api-key` header; getSession then resolves it to the owning user.
		plugins: [apiKey({ enableSessionForAPIKeys: true }) as any],
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
						const role = resolveSignupRole(
							user.email,
							allowedDomainsSetting,
							adminEmailsSetting,
						);

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
