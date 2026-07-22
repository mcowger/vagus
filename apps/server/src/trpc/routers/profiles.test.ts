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

function createCaller(userId = "user-123") {
	return appRouter.createCaller({
		db,
		user: {
			id: userId,
			email: "test@example.com",
			name: "Test User",
			role: "user",
			isDisabled: false,
		},
		session: null,
	});
}

test("getProfile returns default profile when none exists", async () => {
	const caller = createCaller("user-1");
	const profile = await caller.profiles.getProfile();

	expect(profile).toBeDefined();
	expect(profile.user_id).toBe("user-1");
	expect(profile.name).toBe("Default Profile");
	expect(profile.keywords).toBe("[]");
	expect(profile.topics).toBe("[]");
	expect(profile.entities).toBe("[]");
	expect(profile.include_rules).toBe("[]");
	expect(profile.exclude_rules).toBe("[]");
	expect(profile.similarity_threshold).toBe(0.65);
	expect(profile.max_cluster_cap).toBe(10);
	expect(profile.ntfy_topic).toBeNull();
	expect(profile.profile_embedding).toBeDefined();
	expect(profile.profile_embedding).not.toBeNull();
});

test("updateProfile updates profile fields and computes embedding", async () => {
	const caller = createCaller("user-2");

	// Initial get creates default
	const initial = await caller.profiles.getProfile();
	expect(initial.name).toBe("Default Profile");

	// Update fields
	const updated = await caller.profiles.updateProfile({
		name: "AI Tech Enthusiast",
		keywords: ["artificial intelligence", "LLM", "agent"],
		topics: ["AI", "Software"],
		entities: ["OpenAI", "Anthropic"],
		include_rules: ["must mention open source"],
		exclude_rules: ["no sponsored content"],
		similarity_threshold: 0.75,
		max_cluster_cap: 15,
		ntfy_topic: "my-ai-alerts",
	});

	expect(updated.name).toBe("AI Tech Enthusiast");
	expect(JSON.parse(updated.keywords)).toEqual(["artificial intelligence", "LLM", "agent"]);
	expect(JSON.parse(updated.topics)).toEqual(["AI", "Software"]);
	expect(JSON.parse(updated.entities)).toEqual(["OpenAI", "Anthropic"]);
	expect(JSON.parse(updated.include_rules)).toEqual(["must mention open source"]);
	expect(JSON.parse(updated.exclude_rules)).toEqual(["no sponsored content"]);
	expect(updated.similarity_threshold).toBe(0.75);
	expect(updated.max_cluster_cap).toBe(15);
	expect(updated.ntfy_topic).toBe("my-ai-alerts");
	expect(updated.profile_embedding).toBeDefined();
	expect(updated.profile_embedding).not.toBeNull();

	// Verify getProfile returns updated profile
	const fetched = await caller.profiles.getProfile();
	expect(fetched.name).toBe("AI Tech Enthusiast");
	expect(fetched.similarity_threshold).toBe(0.75);
	expect(fetched.ntfy_topic).toBe("my-ai-alerts");
});

test("updateProfile supports string inputs for array fields", async () => {
	const caller = createCaller("user-3");

	const updated = await caller.profiles.updateProfile({
		keywords: "ts, react, bun",
		topics: "[\"Web\", \"Dev\"]",
	});

	expect(JSON.parse(updated.keywords)).toEqual(["ts", "react", "bun"]);
	expect(JSON.parse(updated.topics)).toEqual(["Web", "Dev"]);
});
