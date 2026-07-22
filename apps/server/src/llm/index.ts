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

export interface LlmCallOptions {
	baseUrl?: string;
	apiKey?: string;
	modelName?: string;
	prompt: string;
	systemPrompt?: string;
	temperature?: number;
	throwOnFailure?: boolean;
}

export async function callLlmCompletion(options: LlmCallOptions): Promise<LlmCompletionResult> {
	const {
		baseUrl = process.env.TESTING_LLM_BASE_URL || "https://api.openai.com/v1",
		apiKey = process.env.TESTING_LLM_KEY || process.env.OPENAI_API_KEY,
		modelName = process.env.TESTING_LLM_MODEL || "gpt-4o-mini",
		prompt,
		systemPrompt,
		temperature = 0.3,
		throwOnFailure = false,
	} = options;

	let promptTokens = Math.ceil((prompt.length + (systemPrompt?.length || 0)) / 4);
	let completionTokens = 0;
	let cost = 0;

	if (!apiKey) {
		if (throwOnFailure) {
			throw new Error("Missing API key for LLM completion");
		}
		const text = `Faux summary for: ${prompt.slice(0, 100).trim()}...`;
		completionTokens = Math.ceil(text.length / 4);
		return { text, usage: { promptTokens, completionTokens, cost: 0 } };
	}

	const base = baseUrl.replace(/\/+$/, "");
	const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

	const messages: Array<{ role: string; content: string }> = [];
	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: prompt });

	try {
		const res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: modelName,
				messages,
				temperature,
			}),
		});

		if (!res.ok) {
			throw new Error(`LLM API returned status ${res.status}: ${res.statusText}`);
		}

		const data = (await res.json()) as any;
		const text = data.choices?.[0]?.message?.content?.trim() || "";
		promptTokens = data.usage?.prompt_tokens || promptTokens;
		completionTokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);
		cost = (promptTokens * 0.15 + completionTokens * 0.6) / 1000000;

		return {
			text,
			usage: {
				promptTokens,
				completionTokens,
				cost,
			},
		};
	} catch (err) {
		logger.error({ err, endpoint, modelName }, "Failed LLM completion call");
		if (throwOnFailure) {
			throw err;
		}
		const fallbackText = `Fallback completion for: ${prompt.slice(0, 80).trim()}`;
		return {
			text: fallbackText,
			usage: {
				promptTokens,
				completionTokens: Math.ceil(fallbackText.length / 4),
				cost: 0,
			},
		};
	}
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
	options?: {
		runId?: number;
		customFauxResponse?: string;
		db?: Kysely<Database>;
		systemPrompt?: string;
	},
): Promise<LlmCompletionResult> {
	const db = getDb(options?.db);
	const config = await getTaskModel(taskName, db);

	let result: LlmCompletionResult;

	if (config.provider === "faux") {
		const text =
			options?.customFauxResponse ||
			`Summary: ${prompt.slice(0, 100).replace(/\n/g, " ").trim()}...`;
		const promptTokens = Math.ceil(prompt.length / 4);
		const completionTokens = Math.ceil(text.length / 4);
		result = {
			text,
			usage: {
				promptTokens,
				completionTokens,
				cost: (promptTokens + completionTokens) * 0.000001,
			},
		};
	} else if (config.provider === "openai" || config.provider === "groq") {
		const pConfig = await db
			.selectFrom("provider_config")
			.selectAll()
			.where("provider", "=", config.provider)
			.executeTakeFirst();

		let baseUrl: string | undefined;
		let apiKey: string | undefined;

		if (pConfig && pConfig.api_key) {
			apiKey = pConfig.api_key;
			if (pConfig.config) {
				try {
					const parsed = JSON.parse(pConfig.config);
					baseUrl = parsed.baseUrl;
				} catch {}
			}
		}

		result = await callLlmCompletion({
			baseUrl,
			apiKey,
			modelName: config.modelName,
			prompt,
			systemPrompt: options?.systemPrompt,
		});
	} else {
		const text = `Summary: ${prompt.slice(0, 100).trim()}...`;
		result = {
			text,
			usage: {
				promptTokens: Math.ceil(prompt.length / 4),
				completionTokens: Math.ceil(text.length / 4),
				cost: 0,
			},
		};
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
				prompt_tokens: result.usage.promptTokens,
				completion_tokens: result.usage.completionTokens,
				estimated_cost: result.usage.cost,
			})
			.execute();
	} catch (err) {
		logger.warn({ err }, "Failed to record LLM usage");
	}

	return result;
}
