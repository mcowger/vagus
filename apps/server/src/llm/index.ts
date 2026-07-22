import type { Kysely } from "kysely";
import { getDb, type Database } from "../db";
import { log as logger } from "../log";

export interface LlmCompletionResult {
	text: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		cost: number;
	};
}

export interface TaskModelConfig {
	provider: string;
	modelName: string;
}

export async function getTaskModel(
	taskName: string,
	passedDb?: Kysely<Database>,
): Promise<TaskModelConfig> {
	const db = getDb(passedDb);
	const row = await db
		.selectFrom("task_model")
		.selectAll()
		.where("task_name", "=", taskName)
		.executeTakeFirst();

	if (row) {
		return {
			provider: row.provider,
			modelName: row.model_name,
		};
	}

	// Default fallback
	return {
		provider: "faux",
		modelName: "faux-cheap",
	};
}

export async function generateCompletion(
	taskName: string,
	prompt: string,
	options?: { runId?: number; customFauxResponse?: string; db?: Kysely<Database> },
): Promise<LlmCompletionResult> {
	const db = getDb(options?.db);
	const config = await getTaskModel(taskName, db);

	let text = "";
	let promptTokens = Math.ceil(prompt.length / 4);
	let completionTokens = 0;
	let cost = 0;

	if (config.provider === "faux") {
		text =
			options?.customFauxResponse ||
			`Summary: ${prompt.slice(0, 100).replace(/\n/g, " ").trim()}...`;
		completionTokens = Math.ceil(text.length / 4);
		cost = (promptTokens + completionTokens) * 0.000001; // Fake cheap cost
	} else if (config.provider === "openai" || config.provider === "groq") {
		// Get API key from provider_config
		const pConfig = await db
			.selectFrom("provider_config")
			.selectAll()
			.where("provider", "=", config.provider)
			.executeTakeFirst();

		if (!pConfig || !pConfig.api_key) {
			logger.warn(
				{ taskName, provider: config.provider },
				"Provider API key missing, falling back to faux completion",
			);
			text = `Fallback summary for: ${prompt.slice(0, 100).trim()}...`;
			completionTokens = Math.ceil(text.length / 4);
			cost = 0;
		} else {
			// Basic OpenAI-compatible REST API call
			const endpoint =
				config.provider === "groq"
					? "https://api.groq.com/openai/v1/chat/completions"
					: "https://api.openai.com/v1/chat/completions";

			try {
				const res = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${pConfig.api_key}`,
					},
					body: JSON.stringify({
						model: config.modelName,
						messages: [{ role: "user", content: prompt }],
						temperature: 0.3,
					}),
				});

				if (!res.ok) {
					throw new Error(`LLM API returned status ${res.status}`);
				}

				const data = (await res.json()) as any;
				text = data.choices?.[0]?.message?.content?.trim() || "";
				promptTokens = data.usage?.prompt_tokens || promptTokens;
				completionTokens = data.usage?.completion_tokens || 10;
				cost = (promptTokens * 0.15 + completionTokens * 0.6) / 1000000;
			} catch (err) {
				logger.error({ err, taskName }, "Failed LLM completion call");
				text = `Generated summary for: ${prompt.slice(0, 80).trim()}`;
			}
		}
	} else {
		text = `Summary: ${prompt.slice(0, 100).trim()}...`;
	}

	// Capture LLM Usage in DB
	try {
		await db
			.insertInto("llm_usage")
			.values({
				run_id: options?.runId ?? null,
				task_name: taskName,
				provider: config.provider,
				model_name: config.modelName,
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				estimated_cost: cost,
			})
			.execute();
	} catch (err) {
		logger.warn({ err }, "Failed to record LLM usage");
	}

	return {
		text,
		usage: {
			promptTokens,
			completionTokens,
			cost,
		},
	};
}
