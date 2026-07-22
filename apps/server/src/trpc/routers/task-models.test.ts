import { afterEach, beforeEach, expect, test } from "bun:test";
import { appRouter } from "../router";
import { createDb } from "../../db/connection";
import { migrateToLatest } from "../../db/migrate";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";

let dbObj: ReturnType<typeof createDb>;
let db: Kysely<Database>;

beforeEach(async () => {
	dbObj = createDb(":memory:");
	db = dbObj.kysely;
	await migrateToLatest(db);
});

afterEach(async () => {
	dbObj.close();
});

function createCaller(role: "admin" | "user" = "admin") {
	return appRouter.createCaller({
		db,
		user: {
			id: "user-1",
			email: "admin@example.com",
			name: "Admin",
			role,
			isDisabled: false,
		},
		session: null,
	});
}

test("getTaskModels returns initial seeded task models", async () => {
	const caller = createCaller("admin");
	const models = await caller.taskModels.getTaskModels();
	expect(models.length).toBeGreaterThanOrEqual(1);
	expect(models.some((m) => m.task_name === "stage_a_bullet")).toBe(true);
});

test("setTaskModel inserts and updates task model config", async () => {
	const caller = createCaller("admin");

	// Insert new task model
	const res1 = await caller.taskModels.setTaskModel({
		taskName: "stage_b_synthesis",
		provider: "openai",
		modelName: "gpt-4o-mini",
	});
	expect(res1.success).toBe(true);

	let models = await caller.taskModels.getTaskModels();
	let synth = models.find((m) => m.task_name === "stage_b_synthesis");
	expect(synth).toBeDefined();
	expect(synth?.provider).toBe("openai");
	expect(synth?.model_name).toBe("gpt-4o-mini");

	// Update existing task model
	const res2 = await caller.taskModels.setTaskModel({
		taskName: "stage_b_synthesis",
		provider: "anthropic",
		modelName: "claude-3-5-sonnet",
	});
	expect(res2.success).toBe(true);

	models = await caller.taskModels.getTaskModels();
	synth = models.find((m) => m.task_name === "stage_b_synthesis");
	expect(synth?.provider).toBe("anthropic");
	expect(synth?.model_name).toBe("claude-3-5-sonnet");
});

test("getLlmUsage returns usage rows and summary", async () => {
	const caller = createCaller("admin");

	// Insert test usage records directly in DB
	await db
		.insertInto("llm_usage")
		.values([
			{
				task_name: "stage_a_bullet",
				provider: "openai",
				model_name: "gpt-4o-mini",
				prompt_tokens: 100,
				completion_tokens: 50,
				estimated_cost: 0.0001,
			},
			{
				task_name: "stage_b_synthesis",
				provider: "anthropic",
				model_name: "claude-3-5-sonnet",
				prompt_tokens: 200,
				completion_tokens: 100,
				estimated_cost: 0.0005,
			},
		])
		.execute();

	const usage = await caller.taskModels.getLlmUsage();
	expect(usage.rows.length).toBe(2);
	expect(usage.summary.totalPromptTokens).toBe(300);
	expect(usage.summary.totalCompletionTokens).toBe(150);
	expect(usage.summary.totalTokens).toBe(450);
	expect(usage.summary.totalCost).toBeCloseTo(0.0006, 6);
});

test("non-admin user is forbidden", async () => {
	const caller = createCaller("user");
	expect(caller.taskModels.getTaskModels()).rejects.toThrow();
});
