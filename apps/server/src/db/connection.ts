import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { config } from "../config";
import type { Database } from "./schema";

// One shared bun:sqlite Database instance, wrapped by Kysely (app tables),
// BetterAuth (auth tables), and plainjob (queue tables). The SAME raw instance
// is handed to each so they co-locate on one connection/file (WAL,
// foreign_keys ON) per TECHNICAL_DESIGN §2.

export interface Db {
	/** Raw bun:sqlite instance — hand this to BetterAuth and plainjob. */
	sqlite: BunDatabase;
	/** Kysely query builder over the same instance (app tables). */
	kysely: Kysely<Database>;
	/** Close the underlying connection. */
	close(): void;
}

function applyPragmas(sqlite: BunDatabase): void {
	sqlite.exec("PRAGMA journal_mode = WAL;");
	sqlite.exec("PRAGMA foreign_keys = ON;");
}

/**
 * Create an isolated Db over the given path. Pass ":memory:" for tests. A
 * file path has its parent directory created if missing.
 */
export function createDb(path: string): Db {
	if (path !== ":memory:") {
		const dir = dirname(path);
		if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
	const sqlite = new BunDatabase(path);
	applyPragmas(sqlite);
	const kysely = new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite }),
	});
	return {
		sqlite,
		kysely,
		close() {
			// Kysely wraps this same instance; closing the raw handle is enough.
			sqlite.close();
		},
	};
}

/** The process-wide shared connection, opened at the configured DB path. */
export const db: Db = createDb(config.dbPath);
