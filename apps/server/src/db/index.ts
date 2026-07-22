import type { Kysely } from "kysely";
import { db } from "./connection";
import type { Database } from "./schema";

let customDb: Kysely<Database> | null = null;

export function setDb(overrideDb: Kysely<Database> | null): void {
	customDb = overrideDb;
}

export function getDb(passedDb?: Kysely<Database> | null): Kysely<Database> {
	return passedDb ?? customDb ?? db.kysely;
}

export * from "./connection";
export * from "./schema";
