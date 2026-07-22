import type { Job } from "plainjob";
import { log } from "../log";

export const NOOP_JOB_TYPE = "noop";

export interface NoopJobData {
	runId: number;
	stageId: number;
}

export async function noopProcessor(job: Job): Promise<void> {
	log.debug("Processing noop job", { id: job.id, type: job.type });
}
