import { type Kysely, type Migration, type MigrationProvider, Migrator } from "kysely";
import * as m0001 from "./migrations/0001_init";
import * as m0002 from "./migrations/0002_m2_sources";
import * as m0003 from "./migrations/0003_m3_extraction";
import * as m0004 from "./migrations/0004_m4_clustering";
import * as m0005 from "./migrations/0005_m5_synthesis";

// Explicit in-code migration registry. We deliberately avoid filesystem
// globbing so migrations resolve deterministically under Bun bundling. Add new
// numbered migrations here in order.
const migrations: Record<string, Migration> = {
	"0001_init": m0001,
	"0002_m2_sources": m0002,
	"0003_m3_extraction": m0003,
	"0004_m4_clustering": m0004,
	"0005_m5_synthesis": m0005,
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
