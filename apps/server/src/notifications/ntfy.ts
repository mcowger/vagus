import type { Kysely } from "kysely";
import type { Database } from "../db/schema";

/**
 * Sanitizes a string for use in HTTP header values (such as ntfy Title).
 * Converts accented characters, smart quotes, dashes, and strips remaining non-ASCII characters.
 */
export function sanitizeAsciiHeader(text: string): string {
	if (!text) return "";

	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
		.replace(/\u2026/g, "...")
		.replace(/[^\x20-\x7E]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Strips raw citation markers (e.g. [art_10], [art_123], [12]) and cleans up extra whitespace or punctuation gaps.
 */
export function stripCitations(text: string): string {
	if (!text) return "";
	return text
		.replace(/\[art_[a-zA-Z0-9_-]+\]/gi, "")
		.replace(/\[\d+\]/g, "")
		.replace(/\s+([.,;:!?])/g, "$1")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s+/g, "\n")
		.trim();
}

export interface SendNotificationResult {
	sent: boolean;
	skipped: boolean;
	reason?: string;
	error?: string;
}

/**
 * Sends a debounced ntfy push notification for a generated digest to the user's configured topic.
 */
export async function sendDigestNotification(
	db: Kysely<Database>,
	digestId: number,
	userId: string,
	customTitle?: string,
): Promise<SendNotificationResult> {
	// 1. Fetch digest details for notification body
	const digest = await db
		.selectFrom("digest")
		.selectAll()
		.where("id", "=", digestId)
		.executeTakeFirst();

	if (!digest) {
		return { sent: false, skipped: true, reason: "Digest not found" };
	}

	// 2. Read ntfy_topic from interest_profile (check digest's profile_id first, then user's active topics)
	let topic: string | null = null;

	if (digest.profile_id) {
		const profile = await db
			.selectFrom("interest_profile")
			.select(["ntfy_topic"])
			.where("id", "=", digest.profile_id)
			.executeTakeFirst();
		if (profile?.ntfy_topic && profile.ntfy_topic.trim() !== "") {
			topic = profile.ntfy_topic.trim();
		}
	}

	if (!topic) {
		const profile = await db
			.selectFrom("interest_profile")
			.select(["ntfy_topic"])
			.where("user_id", "=", userId)
			.where("ntfy_topic", "is not", null)
			.where("ntfy_topic", "!=", "")
			.executeTakeFirst();
		if (profile?.ntfy_topic && profile.ntfy_topic.trim() !== "") {
			topic = profile.ntfy_topic.trim();
		}
	}

	if (!topic) {
		return { sent: false, skipped: true, reason: "No ntfy_topic configured" };
	}

	// 3. Debounce: Check if notification was already successfully sent for this digest/user
	const existingSent = await db
		.selectFrom("notification_log")
		.select("id")
		.where("user_id", "=", userId)
		.where("digest_id", "=", digestId)
		.where("status", "=", "sent")
		.executeTakeFirst();

	if (existingSent) {
		return { sent: false, skipped: true, reason: "Already sent" };
	}

	// 4. Read system settings for ntfy, application base URL, and notification limits
	const settingsRows = await db
		.selectFrom("system_setting")
		.select(["key", "value"])
		.where("key", "in", [
			"ntfy_base_url",
			"notification_base_url",
			"app_base_url",
			"notification_max_takeaways",
			"notification_max_characters",
		])
		.execute();

	const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
	const ntfyBaseVal = settingsMap.get("ntfy_base_url");
	const baseUrl = (ntfyBaseVal || process.env.NTFY_BASE_URL || "https://ntfy.sh").trim();
	const appBaseVal =
		settingsMap.get("notification_base_url") ||
		settingsMap.get("app_base_url");

	const appBaseUrl = (
		appBaseVal ||
		process.env.NOTIFICATION_BASE_URL ||
		process.env.APP_BASE_URL ||
		process.env.BETTER_AUTH_URL ||
		"http://localhost:5173"
	).trim();

	const rawMaxTakeaways = settingsMap.get("notification_max_takeaways");
	const maxTakeaways =
		rawMaxTakeaways !== undefined && rawMaxTakeaways !== ""
			? parseInt(rawMaxTakeaways, 10)
			: 2;

	const rawMaxChars = settingsMap.get("notification_max_characters");
	const maxChars =
		rawMaxChars !== undefined && rawMaxChars !== ""
			? parseInt(rawMaxChars, 10)
			: 300;

	let bodyText = "";
	let items: string[] = [];

	if (digest.key_takeaways) {
		try {
			const takeaways = JSON.parse(digest.key_takeaways);
			if (Array.isArray(takeaways)) {
				items = takeaways
					.map((item) => stripCitations(String(item)))
					.filter((item) => item.length > 0);
			}
		} catch {
			const raw = stripCitations(String(digest.key_takeaways));
			if (raw) items = [raw];
		}
	}

	if (items.length > 0) {
		if (!isNaN(maxTakeaways) && maxTakeaways > 0 && items.length > maxTakeaways) {
			items = items.slice(0, maxTakeaways);
		}
		bodyText = items.join("\n");
	} else if (digest.executive_summary) {
		bodyText = stripCitations(digest.executive_summary);
	} else if (digest.why_it_matters) {
		bodyText = stripCitations(digest.why_it_matters);
	}

	if (!bodyText) {
		bodyText = "New intelligence digest available.";
	}

	if (!isNaN(maxChars) && maxChars > 0 && bodyText.length > maxChars) {
		bodyText = bodyText.slice(0, maxChars - 3).trim() + "...";
	}
	const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
	const cleanTopic = topic.replace(/^\/+/, "");
	const cleanAppBaseUrl = appBaseUrl.replace(/\/+$/, "");

	const rawTitle = customTitle || "New Intelligence Digest";
	const title = sanitizeAsciiHeader(rawTitle);

	const url = `${cleanBaseUrl}/${cleanTopic}`;
	const clickUrl = `${cleanAppBaseUrl}/digests/${digestId}`;

	const now = new Date().toISOString();

	// 5. POST to ntfy endpoint and log outcome to notification_log
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Title: title,
				Click: clickUrl,
				Tags: "newspaper,briefing",
			},
			body: bodyText,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			const errMsg = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;

			await db
				.insertInto("notification_log")
				.values({
					user_id: userId,
					digest_id: digestId,
					topic,
					status: "failed",
					error: errMsg,
					sent_at: now,
				})
				.execute();

			return { sent: false, skipped: false, error: errMsg };
		}

		await db
			.insertInto("notification_log")
			.values({
				user_id: userId,
				digest_id: digestId,
				topic,
				status: "sent",
				error: null,
				sent_at: now,
			})
			.execute();

		return { sent: true, skipped: false };
	} catch (err: any) {
		const errMsg = err?.message || String(err);

		await db
			.insertInto("notification_log")
			.values({
				user_id: userId,
				digest_id: digestId,
				topic,
				status: "failed",
				error: errMsg,
				sent_at: now,
			})
			.execute();

		return { sent: false, skipped: false, error: errMsg };
	}
}
