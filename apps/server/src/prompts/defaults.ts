import type { Kysely } from "kysely";
import type { Database } from "../db";

export interface PromptDefinition {
	key: string;
	name: string;
	stage: string;
	description: string;
	defaultSystemPrompt: string;
	defaultUserPrompt: string;
	variables: string[];
}

export const PROMPT_DEFINITIONS: Record<string, PromptDefinition> = {
	stage_a_bullet: {
		key: "stage_a_bullet",
		name: "Stage A: Article Bullet Extraction",
		stage: "Extraction",
		description: "Summarizes a single article into a 1-sentence headline bullet point.",
		defaultSystemPrompt:
			"You are an expert news editor. Output a concise 1-sentence bullet point summarizing the core article headline or finding.",
		defaultUserPrompt:
			"Summarize the following article in a concise 1-sentence bullet point:\n\nTitle: {{title}}\n\nContent:\n{{content}}",
		variables: ["title", "content"],
	},
	stage_b_synthesis: {
		key: "stage_b_synthesis",
		name: "Stage B: Cluster Synthesis",
		stage: "Cluster Synthesis",
		description:
			"Synthesizes clustered articles into a structured cluster summary with title and citations.",
		defaultSystemPrompt:
			"You are a news synthesis assistant. Your task is to analyze multiple articles in a cluster and generate a synthesized summary in structured JSON format matching ClusterSummaryToolSchema.",
		defaultUserPrompt:
			'Synthesize the following articles in this cluster into a unified summary with citations.\n\n{{articlesText}}\n\nRespond ONLY with valid JSON matching:\n{\n  "title": "Headline title summarizing cluster",\n  "summary": "3-5 sentence unified summary with [art_X] citations",\n  "citations": ["art_1", "art_2"]\n}',
		variables: ["articlesText"],
	},
	stage_c_assembly: {
		key: "stage_c_assembly",
		name: "Stage C: Digest Assembly",
		stage: "Digest Assembly",
		description:
			"Assembles cluster summaries into the final executive briefing digest with trend bullet cards, key takeaways, and why it matters.",
		defaultSystemPrompt:
			"You are a professional executive editor assembling a high-level daily briefing digest. Output valid JSON matching the specified schema.",
		defaultUserPrompt:
			'Synthesize an overall executive digest from the following cluster summaries:\n\n{{clustersText}}{{quotesText}}\n\nPlease provide a structured JSON response matching:\n{\n  "executive_summary": "Formatted bullet points for each identified key trend or major development (e.g., \'- **Trend Title**: Clear synthesis of this trend with relevant citations [art_1]\')",\n  "key_takeaways": ["3-5 key actionable takeaways across all selected news stories"],\n  "why_it_matters": "Broad significance and impact for the user\'s domain/interests"\n}',
		variables: ["clustersText", "quotesText"],
	},
	event_identity_merge: {
		key: "event_identity_merge",
		name: "Story Event Identity Merge",
		stage: "Clustering",
		description: "Determines whether coverage belongs in one reader-facing ongoing news topic.",
		defaultSystemPrompt:
			"You are a news editor deciding whether coverage belongs in one reader-facing ongoing topic. Accept only coverage tied to the same ongoing event, conflict, policy agenda, or developing situation. Reject a broad category, company, country, government body, or person when the articles describe unrelated developments.",
		defaultUserPrompt:
			"Do these articles belong in one reader-facing ongoing topic? Respond only with JSON: {\"same_topic\": true} or {\"same_topic\": false}.\n\nTopic: {{topic}}\n\nArticles:\n{{articles}}",
		variables: ["topic", "articles"],
	},
	scoring_tiebreaker: {
		key: "scoring_tiebreaker",
		name: "Scoring: Relevance Evaluation",
		stage: "Scoring",
		description:
			"Evaluates article cluster relevance against user interest criteria when vector scores tie or require LLM evaluation.",
		defaultSystemPrompt:
			"You are an expert content curator evaluating article cluster relevance for a user.",
		defaultUserPrompt:
			"Evaluate the relevance of this article cluster for the given user interest profile.\n\nUser Profile:\n{{profileText}}\n\nCluster Title: {{title}}\nSummary: {{summary}}\n\nRate relevance from 0.0 to 1.0 and briefly explain why.",
		variables: ["profileText", "title", "summary"],
	},
};

/** Helper to fetch prompt templates from system_setting or fall back to defaults */
export async function getPromptTemplates(
	db: Kysely<Database> | null | undefined,
	promptKey: string,
): Promise<{ systemPrompt: string; userPromptTemplate: string }> {
	const def = PROMPT_DEFINITIONS[promptKey];
	if (!def) {
		throw new Error(`Unknown prompt key: ${promptKey}`);
	}

	if (!db) {
		return {
			systemPrompt: def.defaultSystemPrompt,
			userPromptTemplate: def.defaultUserPrompt,
		};
	}

	const sysKey = `prompt_${promptKey}_system`;
	const userKey = `prompt_${promptKey}_user`;

	const rows = await db
		.selectFrom("system_setting")
		.select(["key", "value"])
		.where("key", "in", [sysKey, userKey])
		.execute();

	let systemPrompt = def.defaultSystemPrompt;
	let userPromptTemplate = def.defaultUserPrompt;

	for (const row of rows) {
		if (row.key === sysKey && row.value?.trim()) {
			systemPrompt = row.value.trim();
		} else if (row.key === userKey && row.value?.trim()) {
			userPromptTemplate = row.value.trim();
		}
	}

	return { systemPrompt, userPromptTemplate };
}

/** Render a user prompt template by replacing {{variable}} placeholders */
export function renderPrompt(
	userPromptTemplate: string,
	variables: Record<string, string>,
): string {
	let result = userPromptTemplate;
	for (const [key, val] of Object.entries(variables)) {
		result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), val ?? "");
	}
	return result;
}
