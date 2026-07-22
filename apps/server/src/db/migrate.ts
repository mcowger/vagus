import { type Kysely, type Migration, type MigrationProvider, Migrator } from "kysely";
import * as m0001 from "./migrations/0001_init";

// Explicit in-code migration registry. We deliberately avoid filesystem
// globbing so migrations resolve deterministically under Bun bundling. Add new
// numbered migrations here in order.
const migrations: Record<string, Migration> = {
	"0001_init": m0001,
};

class StaticMigrationProvider implements MigrationProvider {
	async getMigrations(): Promise<Record<string, Migration>> {
		return migrations;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator operates on any schema.
export async function migrateToLatest(db: Kysely<any>): Promise<void> {
	const migrator = new Migrator({
		db,
		provider: new StaticMigrationProvider(),
	});
	const { error, results } = await migrator.migrateToLatest();
	if (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	void results;
}
