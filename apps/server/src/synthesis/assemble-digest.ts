import type { Kysely } from "kysely";
import type { Job } from "plainjob";
import { getDb, type Database } from "../db";
import { generateCompletion } from "../llm";
import { log } from "../log";
import { advanceStage } from "../queue/coordinator";
import type { AssembleDigestJobData } from "../queue/synthesis-contracts";
import type { DigestResult } from "./types";

export function parseDigestResult(text: string): DigestResult {
	let cleanText = text.trim();
	if (cleanText.startsWith("```")) {
		cleanText = cleanText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
	}

	try {
		const parsed = JSON.parse(cleanText);
		if (typeof parsed === "object" && parsed !== null) {
			const executive_summary =
				typeof parsed.executive_summary === "string" ? parsed.executive_summary : text;

			const key_takeaways = Array.isArray(parsed.key_takeaways)
				? parsed.key_takeaways.map((item: any) => String(item))
				: [];

			const why_it_matters =
				typeof parsed.why_it_matters === "string" && parsed.why_it_matters.trim().length > 0
					? parsed.why_it_matters
					: "Key developments matching your specified interest profile.";

			const key_quotes = Array.isArray(parsed.key_quotes)
				? parsed.key_quotes
						.filter((q: any) => q && typeof q === "object")
						.map((q: any) => ({
							quote: typeof q.quote === "string" ? String(q.quote) : "",
							citation: typeof q.citation === "string" ? String(q.citation) : "",
						}))
				: [];

			return {
				executive_summary,
				key_takeaways,
				why_it_matters,
				key_quotes,
			};
		}
	} catch {
		// JSON parsing failed, fallback below
	}

	return {
		executive_summary: text,
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

	const { runId, stageId, userId } = data;

	log.info("Starting assemble-digest job", { jobId: job.id, userId, runId });

	const database = getDb(db);

	try {
		// Join digest and digest_cluster for specified runId and userId
		const clusterRows = await database
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
			.where("digest.user_id", "=", userId)
			.execute();

		if (clusterRows.length === 0) {
			log.warn("No digest clusters found for assemble-digest job", {
				jobId: job.id,
				userId,
				runId,
			});
			return;
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

		// Format prompt with cluster titles, summaries, perspectives, timeline, and key quotes/citations
		const clustersText = clusterRows
			.map((row, index) => {
				let perspectives: string[] = [];
				try {
					perspectives = JSON.parse(row.perspectives);
				} catch {
					if (row.perspectives) perspectives = [row.perspectives];
				}

				let timeline: string[] = [];
				try {
					timeline = JSON.parse(row.timeline);
				} catch {
					if (row.timeline) timeline = [row.timeline];
				}

				return `Topic Cluster ${index + 1}:
Title: ${row.title}
Summary: ${row.summary}
Perspectives: ${perspectives.join("; ")}
Timeline: ${timeline.join("; ")}`;
			})
			.join("\n\n");

		let quotesText = "";
		if (citations.length > 0) {
			quotesText =
				"\n\nKey Quotes & Primary Citations:\n" +
				citations
					.map(
						(c) =>
							`Citation [${c.citation_key}] (${c.title}): ${c.stage_a_bullet || c.content?.slice(0, 200) || ""}`,
					)
					.join("\n");
		}

		const prompt = `Synthesize an overall executive digest from the following cluster summaries, perspectives, timeline, and key quotes:

${clustersText}${quotesText}

Please provide a structured JSON response matching:
{
  "executive_summary": "High-level summary overview of all selected topics in this digest",
  "key_takeaways": ["3-5 key actionable takeaways across all selected news stories"],
  "why_it_matters": "Broad significance and impact for the user's domain/interests",
  "key_quotes": [
    {
      "quote": "Selected verbatim quote from primary sources",
      "citation": "Citation key like art_1"
    }
  ]
}`;

		const systemPrompt = `You are a professional executive editor assembling a high-level daily briefing digest. Output valid JSON matching the specified schema.`;

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
	} finally {
		await advanceStage(database, stageId, job.id);
	}
}
