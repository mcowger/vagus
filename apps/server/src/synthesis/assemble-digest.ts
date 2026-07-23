import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { getDb, type Database } from "../db";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { getPromptTemplates, renderPrompt } from "../prompts/defaults";
import { advanceStage, failStage } from "../queue/coordinator";
import type { AssembleDigestJobData } from "../queue/synthesis-contracts";
import { extractJsonFromText, sanitizeTextContent } from "../utils/json";
import type { DigestResult } from "./types";

export function parseDigestResult(text: string): DigestResult {
	const parsed = extractJsonFromText(text);

	if (typeof parsed === "object" && parsed !== null) {
		const executive_summary =
			typeof parsed.executive_summary === "string"
				? sanitizeTextContent(parsed.executive_summary)
				: sanitizeTextContent(text);

		const key_takeaways = Array.isArray(parsed.key_takeaways)
			? parsed.key_takeaways.map((item: any) => sanitizeTextContent(String(item)))
			: [];

		const why_it_matters =
			typeof parsed.why_it_matters === "string" && parsed.why_it_matters.trim().length > 0
				? sanitizeTextContent(parsed.why_it_matters)
				: "Key developments matching your specified interest profile.";

		const key_quotes = Array.isArray(parsed.key_quotes)
			? parsed.key_quotes
					.filter((q: any) => q && typeof q === "object")
					.map((q: any) => ({
						quote: typeof q.quote === "string" ? sanitizeTextContent(String(q.quote)) : "",
						citation: typeof q.citation === "string" ? sanitizeTextContent(String(q.citation)) : "",
					}))
			: [];

		return {
			executive_summary,
			key_takeaways,
			why_it_matters,
			key_quotes,
		};
	}

	return {
		executive_summary: sanitizeTextContent(text),
		key_takeaways: [],
		why_it_matters: "Key developments matching your specified interest profile.",
		key_quotes: [],
	};
}

export async function processAssembleDigestJob(
	db: Kysely<Database> | null | undefined,
	job: Job,
): Promise<void> {
	let data: AssembleDigestJobData;
	if (typeof job.data === "string") {
		data = JSON.parse(job.data) as AssembleDigestJobData;
	} else if (typeof job.data === "object" && job.data !== null) {
		data = job.data as AssembleDigestJobData;
	} else {
		throw new Error(`Invalid job data type: ${typeof job.data}`);
	}

	const { runId, stageId, userId, profileId } = data;

	log.info("Starting assemble-digest job", { jobId: job.id, userId, profileId, runId });

	const database = getDb(db);

	try {
		// Join digest and digest_cluster for specified runId and userId
		let query = database
			.selectFrom("digest_cluster")
			.innerJoin("digest", "digest.id", "digest_cluster.digest_id")
			.select([
				"digest.id as digest_id",
				"digest_cluster.id as digest_cluster_id",
				"digest_cluster.cluster_id",
				"digest_cluster.title",
				"digest_cluster.summary",
				"digest_cluster.perspectives",
				"digest_cluster.timeline",
			])
			.where("digest.run_id", "=", runId)
			.where("digest.user_id", "=", userId);

		if (profileId) {
			query = query.where("digest.profile_id", "=", profileId);
		}

		const clusterRows = await query.execute();

		if (clusterRows.length === 0) {
			throw new Error(`No digest clusters found for user ${userId} in run ${runId}`);
		}

		const digestId = clusterRows[0].digest_id;

		// Fetch any citations associated with this digest
		const citations = await database
			.selectFrom("citation")
			.innerJoin("article", "article.id", "citation.article_id")
			.select([
				"citation.citation_key",
				"citation.digest_cluster_id",
				"article.title",
				"article.stage_a_bullet",
				"article.content",
			])
			.where("citation.digest_id", "=", digestId)
			.execute();

		// Format prompt with cluster titles and summaries
		const clustersText = clusterRows
			.map((row, index) => {
				return `Topic Cluster ${index + 1}:
Title: ${row.title}
Summary: ${row.summary}`;
			})
			.join("\n\n");

		let quotesText = "";
		if (citations.length > 0) {
			quotesText =
				"\n\nPrimary Source Citations:\n" +
				citations
					.map(
						(c) =>
							`Citation [${c.citation_key}] (${c.title}): ${c.stage_a_bullet || c.content?.slice(0, 200) || ""}`,
					)
					.join("\n");
		}

		const { systemPrompt, userPromptTemplate } = await getPromptTemplates(database, "stage_c_assembly");
		const prompt = renderPrompt(userPromptTemplate, {
			clustersText,
			quotesText,
		});

		// Call LLM completion using task_name: "stage_c_assembly"
		const completion = await generateCompletion("stage_c_assembly", prompt, {
			runId,
			db: database,
			systemPrompt,
		});

		// Extract structured output matching DigestToolSchema
		const digestResult = parseDigestResult(completion.text);

		// Update digest row for (run_id, user_id)
		await database
			.updateTable("digest")
			.set({
				executive_summary: digestResult.executive_summary,
				key_takeaways: JSON.stringify(digestResult.key_takeaways),
				why_it_matters: digestResult.why_it_matters,
				key_quotes: JSON.stringify(digestResult.key_quotes),
			})
			.where("run_id", "=", runId)
			.where("user_id", "=", userId)
			.execute();

		log.info("Successfully updated digest for assemble-digest job", {
			jobId: job.id,
			userId,
			runId,
			digestId,
		});
	} catch (err) {
		log.error("Failed assemble-digest job execution", {
			jobId: job.id,
			userId,
			runId,
			error: String(err),
		});
		await failStage(database, stageId, String(err));
		throw err;
	}

	await advanceStage(database, stageId, job.id);
}
