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

afterEach(() => {
	dbObj.close();
});

test("lists and retrieves published digests without authentication", async () => {
	const run = await db
		.insertInto("run")
		.values({ trigger: "manual", status: "complete", started_at: "2026-07-23T00:00:00.000Z" })
		.returning("id")
		.executeTakeFirstOrThrow();
	const digest = await db
		.insertInto("digest")
		.values({
			run_id: run.id,
			user_id: "owner-only",
			profile_id: null,
			executive_summary: "Published executive summary.",
			key_takeaways: "[]",
			why_it_matters: "Published context.",
			key_quotes: "[]",
			created_at: "2026-07-23T00:00:00.000Z",
		})
		.returning("id")
		.executeTakeFirstOrThrow();

	const caller = appRouter.createCaller({ db, user: null, session: null });
	const digests = await caller.digest.listPublic();
	const publishedDigest = await caller.digest.getPublicById({ id: digest.id });

	expect(digests).toHaveLength(1);
	expect(digests[0]).toMatchObject({ id: digest.id, executive_summary: "Published executive summary." });
	expect(digests[0]).not.toHaveProperty("user_id");
	expect(publishedDigest).toMatchObject({ id: digest.id, executive_summary: "Published executive summary." });
	expect(publishedDigest).not.toHaveProperty("user_id");
});
