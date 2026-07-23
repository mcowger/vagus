import { Database as Sqlite } from "bun:sqlite";
import { createDb } from "../apps/server/src/db/connection";
import { migrateToLatest } from "../apps/server/src/db/migrate";

const STAGING_DB_PATH = process.env.VAGUS_STAGING_DB_PATH ?? "/mnt/user/appdata/vagus/vagus.db";
const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";

function copyStagingData(dev: Sqlite): void {
	console.log("[sync] Attaching staging database...");
	dev.exec(`ATTACH DATABASE '${STAGING_DB_PATH.replaceAll("'", "''")}' AS staging`);
	dev.exec("BEGIN IMMEDIATE");
	try {
		console.log("[sync] Clearing local sources, articles, pipeline output, and model configuration...");
		dev.exec(`
			DELETE FROM citation; DELETE FROM digest_cluster; DELETE FROM digest;
			DELETE FROM user_selected_cluster; DELETE FROM cluster_article; DELETE FROM cluster;
			DELETE FROM article_embedding; DELETE FROM article; DELETE FROM processed_key;
			DELETE FROM user_source_weight; DELETE FROM source; DELETE FROM llm_usage;
			DELETE FROM run_stage; DELETE FROM run; DELETE FROM provider_config; DELETE FROM task_model;
		`);
		console.log("[sync] Copying 25 staging sources, article records with article summaries, and provider configuration...");
		dev.exec(`
			INSERT INTO source (id, type, name, url, config, enabled, owner_user_id, created_at, updated_at)
			SELECT id, type, name, url, config, enabled, owner_user_id, created_at, updated_at FROM staging.source;
			INSERT INTO processed_key (id, identity_key, source_id, processed_at)
			SELECT id, identity_key, source_id, processed_at FROM staging.processed_key;
			INSERT INTO article (id, run_id, identity_key, source_id, title, url, author, content, publish_date, image_url, reading_time_minutes, stage_a_bullet, fetched_at, created_at)
			SELECT id, NULL, identity_key, source_id, title, url, author, content, publish_date, image_url, reading_time_minutes, stage_a_bullet, fetched_at, created_at FROM staging.article;
			INSERT INTO provider_config (id, provider, api_key, enabled, config, created_at, updated_at)
			SELECT id, provider, api_key, enabled, config, created_at, updated_at FROM staging.provider_config;
			INSERT INTO task_model (id, task_name, provider, model_name, created_at, updated_at)
			SELECT id, task_name, provider, model_name, created_at, updated_at FROM staging.task_model;
			INSERT INTO task_model (task_name, provider, model_name)
			SELECT 'event_identity_merge', provider, model_name FROM task_model WHERE task_name = 'stage_b_synthesis'
			ON CONFLICT(task_name) DO NOTHING;
		`);
		dev.exec("COMMIT");
		const counts = dev.query("SELECT (SELECT count(*) FROM source) AS sources, (SELECT count(*) FROM article) AS articles, (SELECT count(*) FROM provider_config) AS providers").get() as Record<string, number>;
		console.log(`[sync] Complete: ${counts.sources} sources, ${counts.articles} articles, ${counts.providers} provider configurations copied.`);
	} catch (error) {
		dev.exec("ROLLBACK");
		console.error("[sync] Failed; local changes were rolled back.");
		throw error;
	} finally {
		dev.exec("DETACH DATABASE staging");
	}
}

const db = createDb(DEV_DB_PATH);
try {
	console.log("[sync] Applying local migrations...");
	await migrateToLatest(db.kysely);
	copyStagingData(db.sqlite);
} finally {
	db.close();
}
