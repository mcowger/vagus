import type { Kysely } from "kysely";
import type { Job, Queue } from "plainjob";
import { getDb, type Database } from "../db";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { getPromptTemplates, renderPrompt } from "../prompts/defaults";
import { advanceStage, failStage } from "../queue/coordinator";
import { SYNTHESIZE_CLUSTER_JOB_TYPE, type SynthesizeClusterJobData } from "../queue/synthesis-contracts";
import { extractJsonFromText, sanitizeTextContent } from "../utils/json";
import { ClusterSummaryResult, validateAndFilterCitations } from "./types";

export function parseClusterSummaryResponse(
	text: string,
	validArticleKeys: Set<string>,
	fallbackTitle: string,
): ClusterSummaryResult {
	const rawObj = extractJsonFromText(text);

	const title =
		typeof rawObj?.title === "string" && rawObj.title.trim()
			? sanitizeTextContent(rawObj.title)
			: fallbackTitle;

	const summary =
		typeof rawObj?.summary === "string" && rawObj.summary.trim()
			? sanitizeTextContent(rawObj.summary)
			: sanitizeTextContent(text) || "Synthesized cluster summary.";

	let perspectives: string[] = [];
	if (Array.isArray(rawObj?.perspectives)) {
		perspectives = rawObj.perspectives.map((p: unknown) => String(p).trim()).filter(Boolean);
	}

	let timeline: string[] = [];
	if (Array.isArray(rawObj?.timeline)) {
		timeline = rawObj.timeline.map((t: unknown) => String(t).trim()).filter(Boolean);
	}

	let citations: string[] = [];
	if (Array.isArray(rawObj?.citations)) {
		citations = rawObj.citations.map((c: unknown) => String(c).trim()).filter(Boolean);
	}

	return {
		title,
		summary,
		perspectives,
		timeline,
		citations,
	};
}

export async function processSynthesizeClusterJob(
	dbOrQueueOrJob: Kysely<Database> | Queue | Job | null | undefined,
	queueOrJob?: Queue | Job | null | undefined,
	jobArg?: Job | null | undefined,
): Promise<void> {
	let db: Kysely<Database> | undefined;
	let queue: Queue | undefined;
	let job: Job;

	if (dbOrQueueOrJob && "data" in (dbOrQueueOrJob as any)) {
		job = dbOrQueueOrJob as Job;
		db = getDb();
	} else if (queueOrJob && "data" in (queueOrJob as any)) {
		db = dbOrQueueOrJob as Kysely<Database>;
		job = queueOrJob as Job;
	} else if (jobArg && "data" in (jobArg as any)) {
		db = dbOrQueueOrJob as Kysely<Database>;
		queue = queueOrJob as Queue;
		job = jobArg as Job;
	} else {
		throw new Error("Invalid arguments provided to processSynthesizeClusterJob");
	}

	let data: SynthesizeClusterJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as SynthesizeClusterJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as SynthesizeClusterJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, userId, profileId, clusterId } = data;

	log.info("Starting synthesize-cluster job", { jobId: job.id, runId, stageId, userId, profileId, clusterId });

	const database = getDb(db);

	try {
		const articles = await database
			.selectFrom("cluster_article")
			.innerJoin("article", "article.id", "cluster_article.article_id")
			.where("cluster_article.cluster_id", "=", clusterId)
			.select([
				"article.id as id",
				"article.title as title",
				"article.content as content",
				"article.stage_a_bullet as stage_a_bullet",
				"cluster_article.is_primary as is_primary",
			])
			.execute();

		if (articles.length === 0) {
			throw new Error(`No articles found for cluster ${clusterId}`);
		}

		const validArticleKeys = new Set<string>();
		const keyToArticleIdMap = new Map<string, number>();

		for (const article of articles) {
			const key = `art_${article.id}`;
			validArticleKeys.add(key);
			keyToArticleIdMap.set(key, article.id);
		}

		let articlesText = "";
		for (const article of articles) {
			const key = `art_${article.id}`;
			articlesText += `--- Article ${key} ---
Title: ${article.title}
Key Bullet: ${article.stage_a_bullet || "N/A"}
Content: ${article.content || "N/A"}\n\n`;
		}

		const { systemPrompt, userPromptTemplate } = await getPromptTemplates(database, "stage_b_synthesis");
		const prompt = renderPrompt(userPromptTemplate, {
			articlesText,
		});

		const completion = await generateCompletion("stage_b_synthesis", prompt, {
			runId,
			db: database,
			systemPrompt,
		});

		const fallbackTitle =
			articles.find((a) => a.is_primary === 1)?.title || articles[0]?.title || `Cluster ${clusterId}`;

		const parsedResult = parseClusterSummaryResponse(completion.text, validArticleKeys, fallbackTitle);

		const validCitations = validateAndFilterCitations(parsedResult.citations, validArticleKeys);

		let digestQuery = database
			.selectFrom("digest")
			.select("id")
			.where("run_id", "=", runId)
			.where("user_id", "=", userId);

		if (profileId) {
			digestQuery = digestQuery.where("profile_id", "=", profileId);
		}

		let digest = await digestQuery.executeTakeFirst();

		const now = new Date().toISOString();

		if (!digest) {
			try {
				digest = await database
					.insertInto("digest")
					.values({
						run_id: runId,
						user_id: userId,
						profile_id: profileId ?? null,
						executive_summary: "",
						key_takeaways: JSON.stringify([]),
						why_it_matters: "",
						key_quotes: JSON.stringify([]),
						created_at: now,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
			} catch {
				digest = await digestQuery.executeTakeFirstOrThrow();
			}
		}

		const existingDigestCluster = await database
			.selectFrom("digest_cluster")
			.select("id")
			.where("digest_id", "=", digest.id)
			.where("cluster_id", "=", clusterId)
			.executeTakeFirst();

		let digestClusterId: number;

		if (existingDigestCluster) {
			await database
				.updateTable("digest_cluster")
				.set({
					title: parsedResult.title,
					summary: parsedResult.summary,
					perspectives: JSON.stringify(parsedResult.perspectives),
					timeline: JSON.stringify(parsedResult.timeline),
				})
				.where("id", "=", existingDigestCluster.id)
				.execute();
			digestClusterId = existingDigestCluster.id;
		} else {
			const inserted = await database
				.insertInto("digest_cluster")
				.values({
					digest_id: digest.id,
					cluster_id: clusterId,
					title: parsedResult.title,
					summary: parsedResult.summary,
					perspectives: JSON.stringify(parsedResult.perspectives),
					timeline: JSON.stringify(parsedResult.timeline),
					created_at: now,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			digestClusterId = inserted.id;
		}

		await database
			.deleteFrom("citation")
			.where("digest_id", "=", digest.id)
			.where("digest_cluster_id", "=", digestClusterId)
			.execute();

		let keysToCite = validCitations;
		if (keysToCite.length === 0) {
			keysToCite = Array.from(validArticleKeys);
		}

		for (const citationKey of keysToCite) {
			const articleId = keyToArticleIdMap.get(citationKey);
			if (articleId !== undefined) {
				await database
					.insertInto("citation")
					.values({
						digest_id: digest.id,
						digest_cluster_id: digestClusterId,
						article_id: articleId,
						citation_key: citationKey,
						created_at: now,
					})
					.execute();
			}
		}

		log.info("Completed synthesize-cluster job", {
			jobId: job.id,
			digestId: digest.id,
			digestClusterId,
			citationsCount: keysToCite.length,
		});
	} catch (err) {
		log.error("Failed synthesize-cluster job execution", {
			jobId: job.id,
			runId,
			clusterId,
			error: String(err),
		});
		await failStage(database, stageId, String(err));
		throw err;
	}

	await advanceStage(database, stageId, job.id);
}
