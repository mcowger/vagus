import { makeSignature } from "better-auth/crypto";
import { auth, resolveSignupRole } from "./auth";
import { db } from "./db/connection";
import { log } from "./log";

/**
 * Dev-only login is enabled ONLY when explicitly opted in AND not in
 * production. In production these code paths are never mounted.
 */
export function isDevAuthEnabled(): boolean {
	return (
		process.env.DEV_AUTH_ENABLED === "true" &&
		process.env.NODE_ENV !== "production"
	);
}

export interface DevLoginResult {
	setCookie: string;
	userId: string;
	role: "admin" | "user";
}

/**
 * Simulate a Google first-login for the given email without the OAuth redirect.
 *
 * Enforces the SAME authorization rules as real login (ADMIN_EMAILS /
 * SIGNUP_ALLOWED_DOMAINS via resolveSignupRole): a disallowed email is rejected
 * exactly as Google would be. On success it mints a real BetterAuth session and
 * returns a signed Set-Cookie string. Safety property: this endpoint can never
 * create an account that Google OAuth couldn't.
 */
export async function devLogin(email: string): Promise<DevLoginResult> {
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail) {
		throw new Error("email is required");
	}

	const ctx = await auth.$context;

	let user = db.sqlite
		.query("SELECT id, role, isDisabled FROM user WHERE email = ?")
		.get(normalizedEmail) as
		| { id: string; role: string; isDisabled: number }
		| null;

	if (!user) {
		// Throws BAD_REQUEST (→ surfaced as 403 by the route) when disallowed.
		const role = resolveSignupRole(
			normalizedEmail,
			process.env.SIGNUP_ALLOWED_DOMAINS ?? "",
			process.env.ADMIN_EMAILS ?? "",
		);
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		db.sqlite.run(
			"INSERT INTO user (id,email,name,role,isDisabled,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)",
			[id, normalizedEmail, normalizedEmail.split("@")[0], role, 0, 1, now, now],
		);
		user = { id, role, isDisabled: 0 };
		log.info("dev-login created user", { email: normalizedEmail, role });
	}

	if (user.isDisabled) {
		throw new Error("User account is disabled");
	}

	const session = await ctx.internalAdapter.createSession(user.id, undefined);
	const cookieName = ctx.authCookies.sessionToken.name;
	const signature = await makeSignature(session.token, ctx.secret);
	const cookieValue = encodeURIComponent(`${session.token}.${signature}`);

	const isHttps = (process.env.BETTER_AUTH_URL || "").startsWith("https");
	const attrs = [
		`${cookieName}=${cookieValue}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		"Max-Age=604800",
	];
	if (isHttps) attrs.push("Secure");

	return {
		setCookie: attrs.join("; "),
		userId: user.id,
		role: user.role as "admin" | "user",
	};
}
