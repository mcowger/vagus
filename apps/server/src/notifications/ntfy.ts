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
	// 1. Read ntfy_topic from interest_profile
	const profile = await db
		.selectFrom("interest_profile")
		.select(["ntfy_topic"])
		.where("user_id", "=", userId)
		.executeTakeFirst();

	if (!profile || !profile.ntfy_topic || profile.ntfy_topic.trim() === "") {
		return { sent: false, skipped: true, reason: "No ntfy_topic configured" };
	}

	const topic = profile.ntfy_topic.trim();

	// 2. Debounce: Check if notification was already successfully sent for this digest/user
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

	// 3. Fetch digest details for notification body
	const digest = await db
		.selectFrom("digest")
		.selectAll()
		.where("id", "=", digestId)
		.executeTakeFirst();

	if (!digest) {
		return { sent: false, skipped: true, reason: "Digest not found" };
	}

	let bodyText = digest.executive_summary?.trim() || "";
	if (!bodyText && digest.key_takeaways) {
		try {
			const takeaways = JSON.parse(digest.key_takeaways);
			if (Array.isArray(takeaways) && takeaways.length > 0) {
				bodyText = takeaways.join("\n");
			}
		} catch {
			bodyText = String(digest.key_takeaways);
		}
	}
	if (!bodyText) {
		bodyText = "New intelligence digest available.";
	}

	// 4. Read ntfy_base_url and app_base_url from system_setting
	const ntfySetting = await db
		.selectFrom("system_setting")
		.select("value")
		.where("key", "=", "ntfy_base_url")
		.executeTakeFirst();

	const baseUrl = (ntfySetting?.value || "https://ntfy.sh").trim();

	const appSetting = await db
		.selectFrom("system_setting")
		.select("value")
		.where("key", "=", "app_base_url")
		.executeTakeFirst();

	const appBaseUrl = (appSetting?.value || process.env.APP_BASE_URL || "http://localhost:5173").trim();

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
