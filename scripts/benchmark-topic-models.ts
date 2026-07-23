import { createDb } from "../apps/server/src/db/connection";
import { callLlmCompletion } from "../apps/server/src/llm";

const DEV_DB_PATH = process.env.VAGUS_DEV_DB_PATH ?? "./data/vagus.db";
const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
const BENCHMARKS = [
	{ topic: "Iran war", articleIds: [71, 204, 401, 500], expected: true },
	{ topic: "UK prime minister", articleIds: [196, 202, 372, 505], expected: true },
	{ topic: "AI", articleIds: [12, 24, 304, 329], expected: false },
	{ topic: "India", articleIds: [68, 283, 349, 498], expected: false },
	{ topic: "Meta", articleIds: [20, 339, 642, 686], expected: false },
	{ topic: "Nvidia", articleIds: [693, 697, 701, 714], expected: true },
];

function parseDecision(text: string): boolean | null {
	try {
		const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as { same_topic?: unknown };
		return typeof parsed.same_topic === "boolean" ? parsed.same_topic : null;
	} catch {
		return null;
	}
}

const db = createDb(DEV_DB_PATH);
try {
	const taskModel = await db.kysely.selectFrom("task_model").select(["provider"]).where("task_name", "=", "event_identity_merge").executeTakeFirstOrThrow();
	const provider = await db.kysely.selectFrom("provider_config").selectAll().where("provider", "=", taskModel.provider).where("enabled", "=", 1).executeTakeFirstOrThrow();
	const baseUrl = provider.config ? (JSON.parse(provider.config) as { baseUrl?: string }).baseUrl : undefined;
	const results: Array<{ model: string; topic: string; expected: boolean; actual: boolean | null; latencyMs: number; cost: number }> = [];

	for (const modelName of MODELS) {
		for (const benchmark of BENCHMARKS) {
			const articles = await db.kysely.selectFrom("article").select(["id", "title", "stage_a_bullet"]).where("id", "in", benchmark.articleIds).execute();
			const prompt = `Do these articles belong in one reader-facing ongoing topic? Accept only coverage tied to the same ongoing event, conflict, policy agenda, or developing situation. Reject a broad category, company, country, government body, or person when the articles describe unrelated developments. Respond only with JSON: {"same_topic": true} or {"same_topic": false}.\n\nTopic: ${benchmark.topic}\n\n${articles.map((article) => `[art_${article.id}] ${article.title}\n${article.stage_a_bullet ?? ""}`).join("\n\n")}`;
			console.log(`[benchmark] ${modelName}: ${benchmark.topic}...`);
			const startedAt = performance.now();
			const completion = await callLlmCompletion({ baseUrl, apiKey: provider.api_key ?? undefined, modelName, prompt });
			results.push({ model: modelName, topic: benchmark.topic, expected: benchmark.expected, actual: parseDecision(completion.text), latencyMs: Math.round(performance.now() - startedAt), cost: completion.usage.cost });
		}
	}

	const summary = MODELS.map((model) => {
		const modelResults = results.filter((result) => result.model === model);
		return {
			model,
			correct: modelResults.filter((result) => result.actual === result.expected).length,
			total: modelResults.length,
			averageLatencyMs: Math.round(modelResults.reduce((sum, result) => sum + result.latencyMs, 0) / modelResults.length),
			totalCost: modelResults.reduce((sum, result) => sum + result.cost, 0),
		};
	});
	console.log(JSON.stringify({ results, summary }, null, 2));
} finally {
	db.close();
}
