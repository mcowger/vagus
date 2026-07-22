import type { Kysely } from "kysely";
import type { Queue } from "plainjob";
import type { Database } from "../db/schema";
import { log } from "../log";
import { startRun, type StartRunResult } from "../queue/coordinator";

let schedulerInterval: Timer | ReturnType<typeof setInterval> | null = null;
let currentDb: Kysely<Database> | null = null;
let currentQueue: Queue | null = null;

/**
 * Parses a cron string or interval string into milliseconds.
 */
export function parseScheduleInterval(schedule: string): number {
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

	// For standard 5-part cron schedules, e.g. "* * * * *" (every minute)
	if (trimmed === "* * * * *") {
		return 60 * 1000;
	}

	// Default fallback for hourly cron ("0 * * * *") or unspecified cron (3,600,000 ms = 1 hour)
	return 60 * 60 * 1000;
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
	if (schedulerInterval !== null) {
		stopScheduler();
	}

	currentDb = db;
	currentQueue = queue;

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
		try {
			await startRun(db, queue, "cron");
		} catch (err) {
			log.error("Error running immediate scheduled run", { error: String(err) });
		}
	}

	schedulerInterval = setInterval(async () => {
		if (!currentDb || !currentQueue) return;
		try {
			const result = await startRun(currentDb, currentQueue, "cron");
			if (!result.started && result.reason === "overlap") {
				log.info("Scheduled run skipped due to active run in progress");
			}
		} catch (err) {
			log.error("Error executing scheduled run tick", { error: String(err) });
		}
	}, intervalMs);
}

/**
 * Stops the active scheduler interval.
 */
export function stopScheduler(): void {
	if (schedulerInterval !== null) {
		clearInterval(schedulerInterval);
		schedulerInterval = null;
	}
	currentDb = null;
	currentQueue = null;
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
	return schedulerInterval !== null;
}
