import { describe, expect, it } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { getPromptTemplates, renderPrompt, PROMPT_DEFINITIONS } from "./defaults";

async function createTestDb(): Promise<Kysely<Database>> {
	const sqlite = new SQLite(":memory:");
	const db = new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite }),
	});
	await migrateToLatest(db);
	return db;
}

describe("Prompt Management & Templates", () => {
	it("returns system default prompt templates when db has no overrides", async () => {
		const db = await createTestDb();
		const templates = await getPromptTemplates(db, "stage_a_bullet");

		expect(templates.systemPrompt).toBe(PROMPT_DEFINITIONS.stage_a_bullet.defaultSystemPrompt);
		expect(templates.userPromptTemplate).toBe(PROMPT_DEFINITIONS.stage_a_bullet.defaultUserPrompt);
	});

	it("renders user prompt template replacing {{variable}} placeholders", () => {
		const template = "Title: {{title}}\nContent: {{content}}";
		const rendered = renderPrompt(template, {
			title: "Breaking News",
			content: "AI model released.",
		});

		expect(rendered).toBe("Title: Breaking News\nContent: AI model released.");
	});

	it("uses customized prompt templates from database when present", async () => {
		const db = await createTestDb();
		const now = new Date().toISOString();

		await db
			.insertInto("system_setting")
			.values([
				{ key: "prompt_stage_a_bullet_system", value: "Custom Editor Persona", updated_at: now },
				{ key: "prompt_stage_a_bullet_user", value: "Custom User Template: {{title}}", updated_at: now },
			])
			.execute();

		const templates = await getPromptTemplates(db, "stage_a_bullet");

		expect(templates.systemPrompt).toBe("Custom Editor Persona");
		expect(templates.userPromptTemplate).toBe("Custom User Template: {{title}}");
	});
});
