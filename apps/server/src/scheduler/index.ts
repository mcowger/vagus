import type { Kysely } from "kysely";
import type { Queue } from "plainjob";
import { Cron } from "croner";
import type { Database } from "../db/schema";
import { log } from "../log";
import { startRun, type StartRunResult } from "../queue/coordinator";

let schedulerInterval: Timer | ReturnType<typeof setInterval> | null = null;
let schedulerCron: Cron | null = null;

const SCHEDULER_TIMEZONE = "America/Los_Angeles";

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
	if (schedulerInterval !== null || schedulerCron !== null) {
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

export function isSchedulerRunning(): boolean {
	return schedulerInterval !== null || schedulerCron !== null;
}
