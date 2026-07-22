import { describe, expect, it } from "bun:test";
import { parseClusterSummaryResponse } from "../synthesis/synthesize-cluster";
import { parseDigestResult } from "../synthesis/assemble-digest";
import { extractJsonFromText, sanitizeTextContent, cleanMarkdownFences } from "./json";

describe("Defensive JSON Extractor & Sanitizer", () => {
	it("extracts valid JSON from markdown code fences starting with ```json { ... }", () => {
		const rawLlmOutput = '```json { "title": "Home Assistant Release", "summary": "New features released.", "perspectives": ["User-centered"], "timeline": ["June 2026"], "citations": ["home-assistant.io"] } ```';
		const parsed = extractJsonFromText(rawLlmOutput);

		expect(parsed).not.toBeNull();
		expect(parsed.title).toBe("Home Assistant Release");
		expect(parsed.summary).toBe("New features released.");
	});

	it("sanitizes text fields containing unparsed markdown code fences", () => {
		const rawSummary = '```json { "summary": "Clean summary text without backticks." } ```';
		const sanitized = sanitizeTextContent(rawSummary);

		expect(sanitized).toBe("Clean summary text without backticks.");
	});

	it("parses cluster summary response defensively when LLM includes extraneous ```json wrappers", () => {
		const rawLlmOutput = '```json { "title": "Home Assistant 2026.6 Release", "summary": "Home Assistant 2026.6 introduces intuitive card pickers.", "perspectives": ["User design"], "timeline": ["June 5, 2026"], "citations": ["art_1"] } ```';
		const validKeys = new Set(["art_1"]);

		const result = parseClusterSummaryResponse(rawLlmOutput, validKeys, "Fallback Title");

		expect(result.title).toBe("Home Assistant 2026.6 Release");
		expect(result.summary).toBe("Home Assistant 2026.6 introduces intuitive card pickers.");
		expect(result.perspectives).toEqual(["User design"]);
		expect(result.citations).toEqual(["art_1"]);
	});

	it("parses digest assembly result defensively when LLM includes backticks and trailing spaces", () => {
		const rawLlmOutput = '```json\n{\n  "executive_summary": "Top developments today.",\n  "key_takeaways": ["Takeaway 1"],\n  "why_it_matters": "High impact.",\n  "key_quotes": [{"quote": "Sample", "citation": "art_1"}]\n}\n```';

		const result = parseDigestResult(rawLlmOutput);

		expect(result.executive_summary).toBe("Top developments today.");
		expect(result.key_takeaways).toEqual(["Takeaway 1"]);
		expect(result.why_it_matters).toBe("High impact.");
	});
});
