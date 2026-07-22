import type { Kysely } from "kysely";
import { auth } from "../auth";
import { db } from "../db/connection";
import type { Database } from "../db/schema";

export interface AuthUser {
	id: string;
	role: "user" | "admin";
	isDisabled: boolean;
	email?: string;
	name?: string;
	[key: string]: unknown;
}

export interface Context {
	db: Kysely<Database>;
	user: AuthUser | null;
	session: unknown | null;
}

export interface CreateContextArgs {
	/** Incoming request — Track A reads auth headers/cookies from here. */
	req?: Request;
}

export async function createContext(args: CreateContextArgs = {}): Promise<Context> {
	if (!args.req) {
		return {
			db: db.kysely,
			user: null,
			session: null,
		};
	}

	try {
		const sessionRes = await auth.api.getSession({
			headers: args.req.headers,
		});

		if (sessionRes?.user && sessionRes?.session) {
			const rawUser = sessionRes.user as Record<string, unknown>;
			const user: AuthUser = {
				...rawUser,
				id: String(rawUser.id),
				role: (rawUser.role as "user" | "admin") ?? "user",
				isDisabled: Boolean(rawUser.isDisabled),
			};
			return {
				db: db.kysely,
				user,
				session: sessionRes.session,
			};
		}
	} catch {
		// Session resolution failed (e.g. invalid or missing auth headers)
	}

	return {
		db: db.kysely,
		user: null,
		session: null,
	};
}
