import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "../db/schema";
import { migrateToLatest } from "../db/migrate";
import { sanitizeAsciiHeader, sendDigestNotification, stripCitations } from "./ntfy";

describe("ntfy notification client", () => {
	let sqlite: SQLite;
	let db: Kysely<Database>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(async () => {
		sqlite = new SQLite(":memory:");
		db = new Kysely<Database>({
			dialect: new BunSqliteDialect({ database: sqlite }),
		});
		await migrateToLatest(db);
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		await db.destroy();
		sqlite.close();
	});

	describe("sanitizeAsciiHeader", () => {
		test("converts accented characters cleanly", () => {
			expect(sanitizeAsciiHeader("Café & Résumé")).toBe("Cafe & Resume");
		});

		test("replaces smart quotes and apostrophes", () => {
			expect(sanitizeAsciiHeader("“Hello” and ‘World’ - It’s fine")).toBe('"Hello" and \'World\' - It\'s fine');
		});

		test("replaces em-dashes and en-dashes", () => {
			expect(sanitizeAsciiHeader("First—Second–Third")).toBe("First-Second-Third");
		});

		test("strips non-ASCII unicode characters and emojis", () => {
			expect(sanitizeAsciiHeader("Daily Briefing 🚀 新闻")).toBe("Daily Briefing");
		});

		test("handles empty or blank input", () => {
			expect(sanitizeAsciiHeader("")).toBe("");
		});
	});
	describe("stripCitations", () => {
		test("removes raw article citation tags and fixes punctuation spaces", () => {
			expect(stripCitations("Breakthrough in AI scaling [art_10] [art_12].")).toBe(
				"Breakthrough in AI scaling.",
			);
			expect(stripCitations("Key development [art_1], and secondary detail [art_2].")).toBe(
				"Key development, and secondary detail.",
			);
		});

		test("removes bracketed numbers and collapses extra spaces", () => {
			expect(stripCitations("Headline news [1] [23]   announced.")).toBe("Headline news announced.");
		});

		test("handles text without citations or empty string", () => {
			expect(stripCitations("Clean headline text.")).toBe("Clean headline text.");
			expect(stripCitations("")).toBe("");
		});
	});

	describe("sendDigestNotification", () => {
		test("skips silently when user has no ntfy_topic", async () => {
			const userId = "user-no-topic";

			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Default Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					profile_embedding: null,
					similarity_threshold: 0.5,
					max_cluster_cap: 10,
					ntfy_topic: null,
				})
				.execute();

			const result = await sendDigestNotification(db, 1, userId);
			expect(result.skipped).toBe(true);
			expect(result.sent).toBe(false);

			const logRows = await db
				.selectFrom("notification_log")
				.selectAll()
				.execute();
			expect(logRows.length).toBe(0);
		});

		test("sends notification to mock HTTP fetch endpoint", async () => {
			const userId = "user-123";
			const topic = "my-test-topic";

			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Tech Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					profile_embedding: null,
					similarity_threshold: 0.5,
					max_cluster_cap: 10,
					ntfy_topic: topic,
				})
				.execute();

			const run = await db
				.insertInto("run")
				.values({
					trigger: "manual",
					status: "complete",
					started_at: new Date().toISOString(),
					finished_at: new Date().toISOString(),
					stats: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "",
					key_takeaways: JSON.stringify(["Major AI breakthrough released today — Café 🚀"]),
					why_it_matters: "High impact",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			let capturedUrl = "";
			let capturedInit: RequestInit | undefined;

			globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
				capturedUrl = input.toString();
				capturedInit = init;
				return new Response("OK", { status: 200 });
			}) as unknown as typeof fetch;

			const result = await sendDigestNotification(db, digest.id, userId, "Custom Header Title — 🚀");

			expect(result.sent).toBe(true);
			expect(result.skipped).toBe(false);
			expect(capturedUrl).toBe("https://ntfy.sh/my-test-topic");
			expect(capturedInit?.method).toBe("POST");

			const headers = capturedInit?.headers as Record<string, string>;
			expect(headers?.Title).toBe("Custom Header Title -");
			expect(headers?.Click).toBe(`http://localhost:5173/digests/${digest.id}`);
			expect(headers?.Tags).toBe("newspaper,briefing");
			expect(capturedInit?.body).toBe("Major AI breakthrough released today — Café 🚀");
		});

		test("debounces duplicate calls for the same user & digest", async () => {
			const userId = "user-debounce";
			const topic = "debounce-topic";

			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Debounce Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					profile_embedding: null,
					similarity_threshold: 0.5,
					max_cluster_cap: 10,
					ntfy_topic: topic,
				})
				.execute();

			const run = await db
				.insertInto("run")
				.values({
					trigger: "manual",
					status: "complete",
					started_at: new Date().toISOString(),
					finished_at: new Date().toISOString(),
					stats: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "Debounce test digest summary.",
					key_takeaways: "[]",
					why_it_matters: "",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			let fetchCallCount = 0;
			globalThis.fetch = (async () => {
				fetchCallCount++;
				return new Response("OK", { status: 200 });
			}) as unknown as typeof fetch;

			// First call should send notification
			const res1 = await sendDigestNotification(db, digest.id, userId);
			expect(res1.sent).toBe(true);
			expect(fetchCallCount).toBe(1);

			// Second call for same digest & user should be debounced
			const res2 = await sendDigestNotification(db, digest.id, userId);
			expect(res2.skipped).toBe(true);
			expect(res2.reason).toBe("Already sent");
			expect(fetchCallCount).toBe(1); // fetch was not called again
		});

		test("records success/failure in notification_log", async () => {
			const userId = "user-log";
			const topic = "log-topic";

			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Log Test Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					profile_embedding: null,
					similarity_threshold: 0.5,
					max_cluster_cap: 10,
					ntfy_topic: topic,
				})
				.execute();

			const run = await db
				.insertInto("run")
				.values({
					trigger: "manual",
					status: "complete",
					started_at: new Date().toISOString(),
					finished_at: new Date().toISOString(),
					stats: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digest1 = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "Digest 1 summary",
					key_takeaways: "[]",
					why_it_matters: "",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const digest2 = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "Digest 2 summary",
					key_takeaways: "[]",
					why_it_matters: "",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			// Test 1: Successful response recorded as "sent"
			globalThis.fetch = (async () => new Response("OK", { status: 200 })) as unknown as typeof fetch;

			const successRes = await sendDigestNotification(db, digest1.id, userId);
			expect(successRes.sent).toBe(true);

			const successLogs = await db
				.selectFrom("notification_log")
				.selectAll()
				.where("digest_id", "=", digest1.id)
				.execute();

			expect(successLogs.length).toBe(1);
			expect(successLogs[0].status).toBe("sent");
			expect(successLogs[0].topic).toBe(topic);
			expect(successLogs[0].error).toBeNull();

			// Test 2: Failed HTTP response recorded as "failed"
			globalThis.fetch = (async () => new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

			const failRes = await sendDigestNotification(db, digest2.id, userId);
			expect(failRes.sent).toBe(false);
			expect(failRes.error).toContain("HTTP 500");

			const failLogs = await db
				.selectFrom("notification_log")
				.selectAll()
				.where("digest_id", "=", digest2.id)
				.execute();

			expect(failLogs.length).toBe(1);
			expect(failLogs[0].status).toBe("failed");
			expect(failLogs[0].topic).toBe(topic);
			expect(failLogs[0].error).toContain("HTTP 500");
		});
		test("respects notification_base_url and content limits (max takeaways & max characters)", async () => {
			const userId = "user-limits-test";
			const topic = "limits-topic";

			await db
				.insertInto("system_setting")
				.values([
					{ key: "notification_base_url", value: "https://custom.app.example.com" },
					{ key: "notification_max_takeaways", value: "2" },
					{ key: "notification_max_characters", value: "100" },
				])
				.onConflict((oc) => oc.column("key").doUpdateSet({ value: (eb) => eb.ref("excluded.value") }))
				.execute();

			await db
				.insertInto("interest_profile")
				.values({
					user_id: userId,
					name: "Limits Profile",
					keywords: "[]",
					topics: "[]",
					entities: "[]",
					include_rules: "[]",
					exclude_rules: "[]",
					profile_embedding: null,
					similarity_threshold: 0.5,
					max_cluster_cap: 10,
					ntfy_topic: topic,
				})
				.execute();

			const run = await db
				.insertInto("run")
				.values({
					trigger: "manual",
					status: "complete",
					started_at: new Date().toISOString(),
					finished_at: new Date().toISOString(),
					stats: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			const takeaways = [
				"First key takeaway describing a major industry shift [art_10].",
				"Second key takeaway focusing on technical implementation details [art_11].",
				"Third key takeaway that should be excluded due to max takeaways limit [art_12].",
			];

			const digest = await db
				.insertInto("digest")
				.values({
					run_id: run.id,
					user_id: userId,
					executive_summary: "",
					key_takeaways: JSON.stringify(takeaways),
					why_it_matters: "",
					key_quotes: "[]",
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			let capturedUrl = "";
			let capturedInit: RequestInit | undefined;

			globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
				capturedUrl = input.toString();
				capturedInit = init;
				return new Response("OK", { status: 200 });
			}) as unknown as typeof fetch;

			const result = await sendDigestNotification(db, digest.id, userId);

			expect(result.sent).toBe(true);
			expect(capturedUrl).toBe(`https://ntfy.sh/${topic}`);

			const headers = capturedInit?.headers as Record<string, string>;
			expect(headers?.Click).toBe(`https://custom.app.example.com/digests/${digest.id}`);

			const body = String(capturedInit?.body);
			// 3rd takeaway is sliced off
			expect(body).not.toContain("Third key takeaway");
			// Citation tags like [art_10] stripped
			expect(body).not.toContain("[art_10]");
			expect(body).not.toContain("[art_11]");
			// Length constrained to <= 100
			expect(body.length).toBeLessThanOrEqual(100);
			expect(body.endsWith("...")).toBe(true);
		});
	});
});
