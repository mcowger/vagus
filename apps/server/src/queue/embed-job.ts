import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { getDb, type Database } from "../db";
import { OpenAiEmbedder } from "../embeddings/openai";
import type { Embedder } from "../embeddings/types";
import { serializeFloat32 } from "../embeddings/types";
import { log } from "../log";
import { advanceStage } from "./coordinator";
import {
	EMBED_ARTICLE_JOB_TYPE,
	type EmbedArticleJobData,
} from "./clustering-contracts";

export async function getEmbedder(db?: Kysely<Database>): Promise<Embedder> {
	if (db) {
		try {
			const taskModel = await db
				.selectFrom("task_model")
				.selectAll()
				.where((eb) =>
					eb.or([
						eb("task_name", "=", "article_embedding"),
						eb("task_name", "=", "embedding"),
					]),
				)
				.executeTakeFirst();

			const providerName = taskModel?.provider || "openai";
			const modelName = taskModel?.model_name || "text-embedding-3-small";

			const pConfig = await db
				.selectFrom("provider_config")
				.selectAll()
				.where("provider", "=", providerName)
				.executeTakeFirst();

			let baseUrl: string | undefined;
			let apiKey: string | undefined = pConfig?.api_key ?? undefined;

			if (pConfig?.config) {
				try {
					const parsed = JSON.parse(pConfig.config);
					baseUrl = parsed.baseUrl;
				} catch {}
			}

			return new OpenAiEmbedder({
				apiKey: apiKey || process.env.OPENAI_API_KEY,
				modelName,
				baseUrl,
			});
		} catch (err) {
			log.warn("Failed to check provider_config or task_model for embedder", { error: String(err) });
		}
	}
	return new OpenAiEmbedder({ apiKey: process.env.OPENAI_API_KEY, modelName: "text-embedding-3-small" });
}

export async function processEmbedArticleJob(
	dbOrJob: Kysely<Database> | Job,
	jobOrEmbedder?: Job | Embedder,
	embedderArg?: Embedder,
): Promise<void> {
	let db: Kysely<Database>;
	let job: Job;
	let embedder: Embedder | undefined;

	if ("data" in dbOrJob && jobOrEmbedder === undefined) {
		job = dbOrJob as Job;
		db = getDb();
		embedder = embedderArg;
	} else if ("data" in (jobOrEmbedder ?? {})) {
		db = dbOrJob as Kysely<Database>;
		job = jobOrEmbedder as Job;
		embedder = embedderArg;
	} else {
		db = dbOrJob as Kysely<Database>;
		job = jobOrEmbedder as Job;
		embedder = embedderArg;
	}

	if (!embedder) {
		embedder = await getEmbedder(db);
	}

	let data: EmbedArticleJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as EmbedArticleJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as EmbedArticleJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, articleId } = data;

	log.info("Starting embed-article job", { jobId: job.id, articleId, runId });

	try {
		const article = await db
			.selectFrom("article")
			.selectAll()
			.where("id", "=", articleId)
			.executeTakeFirst();

		if (!article) {
			log.warn("Article not found for embed-article job", { articleId, jobId: job.id });
			return;
		}

		// Idempotency check: skip if embedding already exists
		const existing = await db
			.selectFrom("article_embedding")
			.select("id")
			.where("article_id", "=", articleId)
			.executeTakeFirst();

		if (existing) {
			log.info("Embedding already exists for article, skipping generation", { articleId });
			return;
		}

		const textToEmbed = [
			article.title,
			article.stage_a_bullet || article.content,
		]
			.filter((t): t is string => Boolean(t && t.trim()))
			.join("\n\n");

		const vector = await embedder.embedText(textToEmbed);
		const serialized = serializeFloat32(vector);

		await db
			.insertInto("article_embedding")
			.values({
				article_id: articleId,
				embedding: serialized,
				model_name: embedder.getModelName(),
				created_at: new Date().toISOString(),
			})
			.execute();

		log.info("Completed embed-article job", {
			articleId,
			dimensions: vector.length,
			modelName: embedder.getModelName(),
		});
	} catch (err) {
		log.error("Failed to process embed-article job", {
			articleId,
			error: String(err),
		});
	} finally {
		await advanceStage(db, stageId, job.id);
	}
}
