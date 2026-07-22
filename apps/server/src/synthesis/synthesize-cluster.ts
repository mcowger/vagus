import type { Kysely } from "kysely";
import type { Job, Queue } from "plainjob";
import { getDb, type Database } from "../db";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { advanceStage } from "../queue/coordinator";
import { SYNTHESIZE_CLUSTER_JOB_TYPE, type SynthesizeClusterJobData } from "../queue/synthesis-contracts";
import { ClusterSummaryResult, validateAndFilterCitations } from "./types";

export function parseClusterSummaryResponse(
	text: string,
	validArticleKeys: Set<string>,
	fallbackTitle: string,
): ClusterSummaryResult {
	let rawObj: any = null;

	try {
		rawObj = JSON.parse(text);
	} catch {
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
		if (jsonMatch && jsonMatch[1]) {
			try {
				rawObj = JSON.parse(jsonMatch[1]);
			} catch {}
		}

		if (!rawObj) {
			const toolMatch = text.match(/\w+\s*\(\s*(\{[\s\S]*\})\s*\)/);
			if (toolMatch && toolMatch[1]) {
				try {
					rawObj = JSON.parse(toolMatch[1]);
				} catch {}
			}
		}

		if (!rawObj) {
			const braceMatch = text.match(/\{[\s\S]*\}/);
			if (braceMatch) {
				try {
					rawObj = JSON.parse(braceMatch[0]);
				} catch {}
			}
		}
	}

	const title =
		typeof rawObj?.title === "string" && rawObj.title.trim()
			? rawObj.title.trim()
			: fallbackTitle;

	const summary =
		typeof rawObj?.summary === "string" && rawObj.summary.trim()
			? rawObj.summary.trim()
			: typeof text === "string" && text.trim()
				? text.trim()
				: "Synthesized cluster summary.";

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

	const { runId, stageId, userId, clusterId } = data;

	log.info("Starting synthesize-cluster job", { jobId: job.id, runId, stageId, userId, clusterId });

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
			log.warn("No articles found for cluster in synthesize-cluster job", { clusterId, jobId: job.id });
			return;
		}

		const validArticleKeys = new Set<string>();
		const keyToArticleIdMap = new Map<string, number>();

		for (const article of articles) {
			const key = `art_${article.id}`;
			validArticleKeys.add(key);
			keyToArticleIdMap.set(key, article.id);
		}

		const systemPrompt = `You are a news synthesis assistant. Your task is to analyze multiple articles in a cluster and generate a synthesized summary in structured JSON format matching ClusterSummaryToolSchema.
Required JSON fields:
- title: string (Concise event headline for this cluster)
- summary: string (Synthesized multi-sentence overview of the cluster)
- perspectives: array of strings (Key perspectives, consensus, or differing viewpoints across sources)
- timeline: array of strings (Chronological sequence of key events reported in sources)
- citations: array of strings (Article citation keys referenced, e.g. ['art_1', 'art_2'])

Important: Only reference article keys that are explicitly provided in the user prompt (e.g. 'art_123'). Do not invent citation keys.`;

		let prompt = `Synthesize the following ${articles.length} articles from cluster ${clusterId}:\n\n`;
		for (const article of articles) {
			const key = `art_${article.id}`;
			prompt += `--- Article ${key} ---
Title: ${article.title}
Key Bullet: ${article.stage_a_bullet || "N/A"}
Content: ${article.content || "N/A"}

`;
		}
		prompt += `Respond with a JSON object or tool call matching the ClusterSummaryToolSchema structure.`;

		const completion = await generateCompletion("stage_b_synthesis", prompt, {
			runId,
			db: database,
			systemPrompt,
		});

		const fallbackTitle =
			articles.find((a) => a.is_primary === 1)?.title || articles[0]?.title || `Cluster ${clusterId}`;

		const parsedResult = parseClusterSummaryResponse(completion.text, validArticleKeys, fallbackTitle);

		const validCitations = validateAndFilterCitations(parsedResult.citations, validArticleKeys);

		let digest = await database
			.selectFrom("digest")
			.select("id")
			.where("run_id", "=", runId)
			.where("user_id", "=", userId)
			.executeTakeFirst();

		const now = new Date().toISOString();

		if (!digest) {
			try {
				digest = await database
					.insertInto("digest")
					.values({
						run_id: runId,
						user_id: userId,
						executive_summary: "",
						key_takeaways: JSON.stringify([]),
						why_it_matters: "",
						key_quotes: JSON.stringify([]),
						created_at: now,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
			} catch {
				digest = await database
					.selectFrom("digest")
					.select("id")
					.where("run_id", "=", runId)
					.where("user_id", "=", userId)
					.executeTakeFirstOrThrow();
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
	} finally {
		await advanceStage(database, stageId, job.id);
	}
}
