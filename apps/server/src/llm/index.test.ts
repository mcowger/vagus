import { expect, spyOn, test } from "bun:test";
import { callLlmCompletion } from "./index";

test("callLlmCompletion sends a selected thinking effort", async () => {
	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			JSON.stringify({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 2, completion_tokens: 1 },
			}),
			{ headers: { "Content-Type": "application/json" } },
		),
	);

	try {
		await callLlmCompletion({
			baseUrl: "https://example.com/v1",
			apiKey: "test-key",
			modelName: "gpt-5",
			prompt: "test",
			thinkingEffort: "high",
		});

		const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(requestBody.reasoning_effort).toBe("high");
	} finally {
		fetchSpy.mockRestore();
	}
});

test("callLlmCompletion omits the reasoning effort when using the model default", async () => {
	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			JSON.stringify({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 2, completion_tokens: 1 },
			}),
			{ headers: { "Content-Type": "application/json" } },
		),
	);

	try {
		await callLlmCompletion({
			baseUrl: "https://example.com/v1",
			apiKey: "test-key",
			modelName: "gpt-4o-mini",
			prompt: "test",
			thinkingEffort: null,
		});

		const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(requestBody).not.toHaveProperty("reasoning_effort");
	} finally {
		fetchSpy.mockRestore();
	}
});
