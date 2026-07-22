import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createDb } from "../../db/connection";
import { migrateToLatest } from "../../db/migrate";
import type { Database } from "../../db/schema";
import { appRouter } from "../router";

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

function createCaller(user: { id: string; role?: "admin" | "user" } | null = { id: "user-1", role: "user" }) {
	return appRouter.createCaller({
		db,
		user: user
			? {
					id: user.id,
					email: "test@example.com",
					name: "Test User",
					role: user.role ?? "user",
					isDisabled: false,
				}
			: null,
		session: null,
	});
}

test("getStats returns zeros when no usage records exist", async () => {
	const caller = createCaller();
	const stats = await caller.usage.getStats();

	expect(stats.grouped).toEqual([]);
	expect(stats.totals).toEqual({
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		totalCost: 0,
		totalCalls: 0,
	});
	expect(stats.byProvider).toEqual([]);
	expect(stats.byTaskModel).toEqual([]);
});

test("getStats groups llm_usage by run_id, provider, task_name, and model_name and computes totals", async () => {
	const caller = createCaller();

	const now = new Date().toISOString();

	// Insert dummy runs to satisfy FK constraints
	await db
		.insertInto("run")
		.values([
			{ id: 1, trigger: "manual", status: "complete", started_at: now, finished_at: now, stats: null },
			{ id: 2, trigger: "manual", status: "complete", started_at: now, finished_at: now, stats: null },
		])
		.execute();

	await db
		.insertInto("llm_usage")
		.values([
			{
				run_id: 1,
				task_name: "stage_a_bullet",
				provider: "openai",
				model_name: "gpt-4o-mini",
				prompt_tokens: 100,
				completion_tokens: 50,
				estimated_cost: 0.0001,
				created_at: now,
			},
			{
				run_id: 1,
				task_name: "stage_a_bullet",
				provider: "openai",
				model_name: "gpt-4o-mini",
				prompt_tokens: 200,
				completion_tokens: 100,
				estimated_cost: 0.0002,
				created_at: now,
			},
			{
				run_id: 1,
				task_name: "stage_b_synthesis",
				provider: "anthropic",
				model_name: "claude-3-5-sonnet",
				prompt_tokens: 500,
				completion_tokens: 250,
				estimated_cost: 0.0015,
				created_at: now,
			},
			{
				run_id: 2,
				task_name: "stage_a_bullet",
				provider: "openai",
				model_name: "gpt-4o-mini",
				prompt_tokens: 150,
				completion_tokens: 75,
				estimated_cost: 0.00015,
				created_at: now,
			},
			{
				run_id: null,
				task_name: "adhoc_task",
				provider: "faux",
				model_name: "faux-cheap",
				prompt_tokens: 50,
				completion_tokens: 25,
				estimated_cost: 0.0,
				created_at: now,
			},
		])
		.execute();

	const stats = await caller.usage.getStats();

	// Total overall stats check
	expect(stats.totals.promptTokens).toBe(1000);
	expect(stats.totals.completionTokens).toBe(500);
	expect(stats.totals.totalTokens).toBe(1500);
	expect(stats.totals.totalCost).toBeCloseTo(0.00195, 5);
	expect(stats.totals.totalCalls).toBe(5);

	// Grouped records check (run_id=1, provider=openai, task=stage_a_bullet, model=gpt-4o-mini grouped into 1 entry with 2 calls)
	const run1OpenAiGroup = stats.grouped.find(
		(g) => g.run_id === 1 && g.provider === "openai" && g.task_name === "stage_a_bullet",
	);
	expect(run1OpenAiGroup).toBeDefined();
	expect(run1OpenAiGroup?.prompt_tokens).toBe(300);
	expect(run1OpenAiGroup?.completion_tokens).toBe(150);
	expect(run1OpenAiGroup?.total_tokens).toBe(450);
	expect(run1OpenAiGroup?.estimated_cost).toBeCloseTo(0.0003, 5);
	expect(run1OpenAiGroup?.count).toBe(2);

	// Provider breakdown check
	const openaiProvider = stats.byProvider.find((p) => p.provider === "openai");
	expect(openaiProvider).toBeDefined();
	expect(openaiProvider?.promptTokens).toBe(450);
	expect(openaiProvider?.completionTokens).toBe(225);
	expect(openaiProvider?.totalTokens).toBe(675);
	expect(openaiProvider?.count).toBe(3);

	const anthropicProvider = stats.byProvider.find((p) => p.provider === "anthropic");
	expect(anthropicProvider).toBeDefined();
	expect(anthropicProvider?.promptTokens).toBe(500);
	expect(anthropicProvider?.completionTokens).toBe(250);
	expect(anthropicProvider?.count).toBe(1);

	// Task model breakdown check
	const stageABulletModel = stats.byTaskModel.find(
		(tm) => tm.taskName === "stage_a_bullet" && tm.modelName === "gpt-4o-mini",
	);
	expect(stageABulletModel).toBeDefined();
	expect(stageABulletModel?.promptTokens).toBe(450);
	expect(stageABulletModel?.completionTokens).toBe(225);
	expect(stageABulletModel?.totalTokens).toBe(675);
	expect(stageABulletModel?.count).toBe(3);
});

test("unauthenticated user throws UNAUTHORIZED", async () => {
	const caller = createCaller(null);
	expect(caller.usage.getStats()).rejects.toThrow("UNAUTHORIZED");
});
