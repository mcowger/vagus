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
	expect(profile.name).toBe("General News");
	expect(profile.keywords).toBe("[]");
	expect(profile.topics).toBe("[]");
	expect(profile.entities).toBe("[]");
	expect(profile.include_rules).toBe("[]");
	expect(profile.exclude_rules).toBe("[]");
	expect(profile.similarity_threshold).toBe(0.65);
	expect(profile.max_cluster_cap).toBe(10);
	expect(profile.schedule_enabled).toBe(0);
	expect(profile.schedule_cron).toBe("0 9 * * *");
	expect(profile.schedule_timezone).toBe("America/Los_Angeles");
	expect(profile.cursor_article_id).toBeNull();
	expect(profile.ntfy_topic).toBeNull();
	expect(profile.profile_embedding).toBeDefined();
	expect(profile.profile_embedding).not.toBeNull();
});

test("updateProfile updates profile fields and computes embedding", async () => {
	const caller = createCaller("user-2");

	// Initial get creates default
	const initial = await caller.profiles.getProfile();
	expect(initial.name).toBe("General News");

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
		schedule_enabled: true,
		schedule_cron: "0 8 * * *",
		schedule_timezone: "America/New_York",
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
	expect(updated.schedule_enabled).toBe(1);
	expect(updated.schedule_cron).toBe("0 8 * * *");
	expect(updated.schedule_timezone).toBe("America/New_York");
	expect(updated.ntfy_topic).toBe("my-ai-alerts");
	expect(updated.profile_embedding).toBeDefined();
	expect(updated.profile_embedding).not.toBeNull();

	// Verify getProfile returns updated profile
	const fetched = await caller.profiles.getProfile();
	expect(fetched.name).toBe("AI Tech Enthusiast");
	expect(fetched.similarity_threshold).toBe(0.75);
	expect(fetched.schedule_enabled).toBe(1);
	expect(fetched.schedule_cron).toBe("0 8 * * *");
	expect(fetched.schedule_timezone).toBe("America/New_York");
	expect(fetched.ntfy_topic).toBe("my-ai-alerts");
});

test("validates schedule_cron and schedule_timezone in createProfile and updateProfile", async () => {
	const caller = createCaller("user-val");

	// Invalid cron in createProfile
	await expect(
		caller.profiles.createProfile({
			name: "Invalid Cron Profile",
			schedule_cron: "not a cron expression",
		}),
	).rejects.toThrow(/schedule_cron/);

	// Invalid timezone in createProfile
	await expect(
		caller.profiles.createProfile({
			name: "Invalid Timezone Profile",
			schedule_timezone: "Mars/Olympus_Mons",
		}),
	).rejects.toThrow(/schedule_timezone/);

	// Valid createProfile with custom schedule
	const profile = await caller.profiles.createProfile({
		name: "Scheduled Profile",
		schedule_enabled: 1,
		schedule_cron: "30 7 * * 1-5",
		schedule_timezone: "Europe/London",
	});

	expect(profile.schedule_enabled).toBe(1);
	expect(profile.schedule_cron).toBe("30 7 * * 1-5");
	expect(profile.schedule_timezone).toBe("Europe/London");

	// Invalid cron in updateProfile
	await expect(
		caller.profiles.updateProfile({
			id: profile.id,
			schedule_cron: "bad cron",
		}),
	).rejects.toThrow(/schedule_cron/);

	// Invalid timezone in updateProfile
	await expect(
		caller.profiles.updateProfile({
			id: profile.id,
			schedule_timezone: "Not/Real",
		}),
	).rejects.toThrow(/schedule_timezone/);
});

test("supports multiple interest category profiles per user", async () => {
	const caller = createCaller("user-multi");

	// List initial
	const initialList = await caller.profiles.listProfiles();
	expect(initialList.length).toBe(1);
	expect(initialList[0].name).toBe("General News");

	// Create second profile
	const techProfile = await caller.profiles.createProfile({
		name: "Tech & AI Deep Dive",
		keywords: ["LLM", "GPU", "Silicon"],
	});

	expect(techProfile.name).toBe("Tech & AI Deep Dive");

	// List profiles
	const updatedList = await caller.profiles.listProfiles();
	expect(updatedList.length).toBe(2);

	// Delete second profile
	await caller.profiles.deleteProfile({ id: techProfile.id });
	const finalList = await caller.profiles.listProfiles();
	expect(finalList.length).toBe(1);
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
