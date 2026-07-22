import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { getDb, type Database } from "../db";
import { extractArticleContent } from "../extractor";
import { log } from "../log";
import { advanceStage } from "./coordinator";
import {
	EXTRACT_ARTICLE_JOB_TYPE,
	type ExtractArticleJobData,
} from "./extraction-contracts";

export async function processExtractArticleJob(
	dbOrJob: Kysely<Database> | Job,
	jobArg?: Job,
): Promise<void> {
	let db: Kysely<Database>;
	let job: Job;

	if ("data" in dbOrJob && jobArg === undefined) {
		job = dbOrJob as Job;
		db = getDb();
	} else {
		db = dbOrJob as Kysely<Database>;
		job = jobArg as Job;
	}

	let data: ExtractArticleJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as ExtractArticleJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as ExtractArticleJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, articleId } = data;

	log.info("Starting extract-article job", { jobId: job.id, articleId, runId });

	try {
		const article = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", articleId)
			.executeTakeFirst();

		if (!article) {
			log.warn("Article not found, skipping extraction", { articleId });
			return;
		}

		const extracted = await extractArticleContent({
			url: article.url,
			title: article.title,
			author: article.author,
			content: article.content,
			imageUrl: article.image_url,
			publishDate: article.publish_date,
		});

		await db
			.updateTable("article")
			.set({
				title: extracted.title || article.title,
				content: extracted.content,
				reading_time_minutes: extracted.readingTimeMinutes,
				author: extracted.author ?? article.author,
				image_url: extracted.imageUrl ?? article.image_url,
				publish_date: extracted.publishDate ?? article.publish_date,
			})
			.where("id", "=", articleId)
			.execute();

		log.info("Completed extract-article job", {
			articleId,
			readingTimeMinutes: extracted.readingTimeMinutes,
		});
	} catch (err) {
		log.error("Failed to process extract-article job", {
			articleId,
			error: String(err),
		});
	} finally {
		await advanceStage(db, stageId, job.id);
	}
}
