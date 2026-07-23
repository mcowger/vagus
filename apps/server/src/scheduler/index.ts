import type { Kysely } from "kysely";
import type { Queue } from "plainjob";
import { Cron } from "croner";
import type { Database } from "../db/schema";
import { log } from "../log";
import { startProfileRun, startRun, type StartProfileRunResult, type StartRunResult } from "../queue/coordinator";

let schedulerInterval: Timer | ReturnType<typeof setInterval> | null = null;
let schedulerCron: Cron | null = null;
let profileSyncInterval: Timer | ReturnType<typeof setInterval> | null = null;
const profileCrons = new Map<number, Cron>();
const profileScheduleKeys = new Map<number, string>();

const SCHEDULER_TIMEZONE = "America/Los_Angeles";
const PROFILE_SYNC_INTERVAL_MS = 60_000;

/**
 * Parses a cron string or interval string into milliseconds.
 */
export function parseScheduleInterval(schedule: string): number | null {
	const trimmed = schedule.trim();

	// Match numeric intervals like "100", "500ms", "10s", "5m", "1h", "1d"
	const intervalMatch = trimmed.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
	if (intervalMatch) {
		const val = Number.parseInt(intervalMatch[1], 10);
		const unit = (intervalMatch[2] || "ms").toLowerCase();
		switch (unit) {
			case "ms":
				return val;
			case "s":
				return val * 1000;
			case "m":
				return val * 60 * 1000;
			case "h":
				return val * 60 * 60 * 1000;
			case "d":
				return val * 24 * 60 * 60 * 1000;
		}
	}

	return null;
}

export function getNextCronRun(schedule: string, startFrom: Date): Date | null {
	return new Cron(schedule, { timezone: SCHEDULER_TIMEZONE, paused: true }).nextRun(startFrom);
}

async function triggerScheduledRun(db: Kysely<Database>, queue: Queue): Promise<void> {
	try {
		const result = await startRun(db, queue, "cron");
		if (!result.started && result.reason === "overlap") {
			log.info("Scheduled run skipped due to active run in progress");
		}
	} catch (err) {
		log.error("Error executing scheduled run", { error: String(err) });
	}
}

async function triggerScheduledProfileRun(
	db: Kysely<Database>,
	queue: Queue,
	profileId: number,
): Promise<void> {
	try {
		const result = await startProfileRun(db, queue, "cron", profileId);
		if (!result.started && result.reason === "overlap") {
			log.info("Scheduled profile run skipped due to active run in progress", { profileId });
		}
	} catch (err) {
		log.error("Error executing scheduled profile run", { profileId, error: String(err) });
	}
}

async function syncProfileSchedulers(db: Kysely<Database>, queue: Queue): Promise<void> {
	const enabledProfiles = await db
		.selectFrom("interest_profile")
		.select(["id", "schedule_cron", "schedule_timezone"])
		.where("schedule_enabled", "=", 1)
		.execute();
	const enabledIds = new Set(enabledProfiles.map((profile) => profile.id));

	for (const [profileId, cron] of profileCrons) {
		if (!enabledIds.has(profileId)) {
			cron.stop();
			profileCrons.delete(profileId);
			profileScheduleKeys.delete(profileId);
		}
	}

	for (const profile of enabledProfiles) {
		const schedule = profile.schedule_cron.trim();
		const timezone = profile.schedule_timezone || SCHEDULER_TIMEZONE;
		const scheduleKey = `${schedule}|${timezone}`;
		if (profileScheduleKeys.get(profile.id) === scheduleKey) continue;

		profileCrons.get(profile.id)?.stop();
		try {
			const cron = new Cron(schedule, { timezone, protect: true }, () => {
				void triggerScheduledProfileRun(db, queue, profile.id);
			});
			profileCrons.set(profile.id, cron);
			profileScheduleKeys.set(profile.id, scheduleKey);
			log.info("Profile scheduler started", { profileId: profile.id, schedule, timezone });
		} catch (err) {
			profileCrons.delete(profile.id);
			profileScheduleKeys.delete(profile.id);
			log.error("Failed to setup profile cron schedule", { profileId: profile.id, error: String(err) });
		}
	}
}

export interface StartSchedulerOptions {
	intervalMs?: number;
	runImmediately?: boolean;
}

/**
 * Starts the background scheduler ticking on the configured schedule from system_setting (`cron_schedule`).
 */
export async function startScheduler(
	db: Kysely<Database>,
	queue: Queue,
	options?: StartSchedulerOptions,
): Promise<void> {
	if (schedulerInterval !== null || schedulerCron !== null || profileCrons.size > 0) {
		stopScheduler();
	}

	let cronSchedule = "0 * * * *";
	try {
		const setting = await db
			.selectFrom("system_setting")
			.select("value")
			.where("key", "=", "cron_schedule")
			.executeTakeFirst();
		if (setting?.value) {
			cronSchedule = setting.value;
		}
	} catch (err) {
		log.error("Failed to fetch cron_schedule setting, using default", {
			error: String(err),
		});
	}

	try {
		await syncProfileSchedulers(db, queue);
		profileSyncInterval = setInterval(() => {
			void syncProfileSchedulers(db, queue).catch((err) => {
				log.error("Failed to refresh profile cron schedules", { error: String(err) });
			});
		}, PROFILE_SYNC_INTERVAL_MS);
	} catch (err) {
		log.error("Failed to setup profile cron schedules", { error: String(err) });
	}

	const intervalMs = options?.intervalMs ?? parseScheduleInterval(cronSchedule);

	if (options?.runImmediately) {
		await triggerScheduledRun(db, queue);
	}

	if (intervalMs !== null) {
		schedulerInterval = setInterval(() => void triggerScheduledRun(db, queue), intervalMs);
		log.info("Scheduler started with interval", { schedule: cronSchedule, intervalMs });
		return;
	}

	schedulerCron = new Cron(
		cronSchedule,
		{ timezone: SCHEDULER_TIMEZONE, protect: true },
		() => triggerScheduledRun(db, queue),
	);
	log.info("Scheduler started with cron", {
		schedule: cronSchedule,
		timezone: SCHEDULER_TIMEZONE,
		nextRun: schedulerCron.nextRun()?.toISOString(),
	});
}

/**
 * Stops the active scheduler interval.
 */
export function stopScheduler(): void {
	if (schedulerInterval !== null) {
		clearInterval(schedulerInterval);
		schedulerInterval = null;
	}
	if (schedulerCron !== null) {
		schedulerCron.stop();
		schedulerCron = null;
	}
	if (profileSyncInterval !== null) {
		clearInterval(profileSyncInterval);
		profileSyncInterval = null;
	}
	for (const [, c] of profileCrons) {
		c.stop();
	}
	profileCrons.clear();
	profileScheduleKeys.clear();
}

/**
 * Triggers a manual pipeline run with overlap guard protection.
 */
export async function triggerManualRun(
	db: Kysely<Database>,
	queue: Queue,
	options?: { expectedJobs?: number; stageName?: string },
): Promise<StartRunResult> {
	return await startRun(db, queue, "manual", options);
}

export async function triggerManualProfileRun(
	db: Kysely<Database>,
	queue: Queue,
	profileId: number,
): Promise<StartProfileRunResult> {
	return await startProfileRun(db, queue, "manual", profileId);
}

export function isSchedulerRunning(): boolean {
	return schedulerInterval !== null || schedulerCron !== null || profileCrons.size > 0;
}
