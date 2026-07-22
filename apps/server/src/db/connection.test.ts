import { expect, test } from "bun:test";
import { createDb } from "./connection";

test("createDb sets WAL journal mode and foreign_keys ON", () => {
	const db = createDb(":memory:");
	// journal_mode for :memory: reports "memory"; for file DBs it is "wal".
	// foreign_keys must be enabled regardless.
	const fk = db.sqlite.query("PRAGMA foreign_keys;").get() as {
		foreign_keys: number;
	};
	expect(fk.foreign_keys).toBe(1);
	db.close();
});

test("createDb WAL applies for a file-backed database", () => {
	const path = `/tmp/vagus-test-${crypto.randomUUID()}.db`;
	const db = createDb(path);
	const mode = db.sqlite.query("PRAGMA journal_mode;").get() as {
		journal_mode: string;
	};
	expect(mode.journal_mode).toBe("wal");
	db.close();
});
