import type { Kysely } from "kysely";
import type { Job, Queue } from "plainjob";
import { getDb, type Database } from "../db";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { getPromptTemplates, renderPrompt } from "../prompts/defaults";
import { advanceStage, failStage } from "./coordinator";
import { STAGE_A_BULLET_JOB_TYPE, type StageABulletJobData } from "./extraction-contracts";

export async function processStageABulletJob(
	db: Kysely<Database> | null | undefined,
	queue: Queue | null | undefined,
	job: Job,
): Promise<void> {
	let data: StageABulletJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as StageABulletJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as StageABulletJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, articleId } = data;

	log.info("Starting stage-a-bullet job", { jobId: job.id, articleId, runId });

	const database = getDb(db);

	try {
		const article = await database
			.selectFrom("article")
			.selectAll()
			.where("id", "=", articleId)
			.executeTakeFirst();

		if (!article) {
			throw new Error(`Article ${articleId} not found for stage-a-bullet job`);
		}

		// Idempotency check: if stage_a_bullet is already set, skip calling LLM
		if (article.stage_a_bullet) {
			log.info("stage_a_bullet already set for article, skipping LLM call", { articleId });
		} else {
			const contentSnippet = article.content ? article.content.trim() : "";
			const { systemPrompt, userPromptTemplate } = await getPromptTemplates(database, "stage_a_bullet");
			const prompt = renderPrompt(userPromptTemplate, {
				title: article.title,
				content: contentSnippet,
			});

			const completion = await generateCompletion("stage_a_bullet", prompt, {
				runId,
				db: database,
				systemPrompt,
			});

			await database
				.updateTable("article")
				.set({ stage_a_bullet: completion.text })
				.where("id", "=", articleId)
				.execute();

			log.info("Updated article stage_a_bullet", { articleId });
		}
	} catch (err) {
		log.error("Failed stage-a-bullet job execution", { articleId, error: String(err) });
		await failStage(database, stageId, String(err));
		throw err;
	}

	await advanceStage(database, stageId, job.id);
}
