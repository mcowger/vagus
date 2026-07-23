import { type Kysely, type Migration, type MigrationProvider, Migrator } from "kysely";
import * as m0001 from "./migrations/0001_init";
import * as m0002 from "./migrations/0002_m2_sources";
import * as m0003 from "./migrations/0003_m3_extraction";
import * as m0004 from "./migrations/0004_m4_clustering";
import * as m0005 from "./migrations/0005_m5_synthesis";
import * as m0006 from "./migrations/0006_m6_scheduling";
import * as m0007 from "./migrations/0007_m8_feedback";
import * as m0008 from "./migrations/0008_m8_topic_category";
import * as m0009 from "./migrations/0009_m9_multi_profiles";
import * as m0010 from "./migrations/0010_m9_min_cluster_count";
import * as m0011 from "./migrations/0011_m9_profile_pacing";
import * as m0012 from "./migrations/0012_m10_remove_faux_task_models";
import * as m0013 from "./migrations/0013_m11_clustering";
import * as m0014 from "./migrations/0014_m11_article_eligibility";
import * as m0015 from "./migrations/0015_m11_topic_clustering";
import * as m0016 from "./migrations/0016_m12_profile_scheduling";

// Explicit in-code migration registry. We deliberately avoid filesystem
// globbing so migrations resolve deterministically under Bun bundling. Add new
// numbered migrations here in order.
const migrations: Record<string, Migration> = {
	"0001_init": m0001,
	"0002_m2_sources": m0002,
	"0003_m3_extraction": m0003,
	"0004_m4_clustering": m0004,
	"0005_m5_synthesis": m0005,
	"0006_m6_scheduling": m0006,
	"0007_m8_feedback": m0007,
	"0008_m8_topic_category": m0008,
	"0009_m9_multi_profiles": m0009,
	"0010_m9_min_cluster_count": m0010,
	"0011_m9_profile_pacing": m0011,
	"0012_m10_remove_faux_task_models": m0012,
	"0013_m11_clustering": m0013,
	"0014_m11_article_eligibility": m0014,
	"0015_m11_topic_clustering": m0015,
	"0016_m12_profile_scheduling": m0016,
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
