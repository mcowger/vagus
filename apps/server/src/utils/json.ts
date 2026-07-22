/** Removes markdown code block wrappers like ```json ... ``` */
export function cleanMarkdownFences(str: string): string {
	if (!str) return "";
	let cleaned = str.trim();

	// Remove leading ```json or ```
	cleaned = cleaned.replace(/^```(?:json|JSON)?\s*/i, "");
	// Remove trailing ```
	cleaned = cleaned.replace(/\s*```$/i, "");

	return cleaned.trim();
}

/** Robust JSON parser that extracts valid JSON objects/arrays from LLM raw text responses */
export function extractJsonFromText<T = any>(text: string): T | null {
	if (!text) return null;

	const clean = cleanMarkdownFences(text);

	// 1. Direct JSON.parse attempt
	try {
		return JSON.parse(clean);
	} catch {}

	// 2. Search for outer {...} block
	const firstBrace = text.indexOf("{");
	const lastBrace = text.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		const jsonCandidate = text.slice(firstBrace, lastBrace + 1);
		try {
			return JSON.parse(jsonCandidate);
		} catch {}

		// 3. Fix unquoted keys, trailing commas and control characters
		const sanitized = jsonCandidate
			.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // Add double quotes around unquoted object keys
			.replace(/,\s*([\}\]])/g, "$1") // Remove trailing commas
			.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
		try {
			return JSON.parse(sanitized);
		} catch {}
	}

	// 4. Fallback Regex Extraction for common JSON object fields (summary, title, etc.)
	const summaryMatch = text.match(/(?:"summary"|summary)\s*:\s*"(.*?)"\s*,\s*(?:"perspectives"|perspectives|timeline|"timeline")/s)
		|| text.match(/(?:"summary"|summary)\s*:\s*"((?:[^"\\]|\\.)*)"/s);

	if (summaryMatch && summaryMatch[1]) {
		const extractedSummary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
		if (extractedSummary) {
			return { summary: extractedSummary } as any;
		}
	}

	// 5. Search for outer [...] array block
	const firstBracket = text.indexOf("[");
	const lastBracket = text.lastIndexOf("]");
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		const jsonCandidate = text.slice(firstBracket, lastBracket + 1);
		try {
			return JSON.parse(jsonCandidate);
		} catch {}
	}

	return null;
}

/**
 * Ensures text content fields do not contain raw markdown code fences
 * or unparsed JSON wrappers from LLM outputs.
 */
export function sanitizeTextContent(str: string | null | undefined): string {
	if (!str) return "";
	let s = str.trim();

	// Strip code fences if present
	if (s.startsWith("```") || s.includes("```json")) {
		s = cleanMarkdownFences(s);
	}

	// Handle strings that are raw JSON objects
	if (s.startsWith("{")) {
		const parsed = extractJsonFromText(s);
		if (parsed && typeof parsed === "object") {
			if (typeof (parsed as any).summary === "string" && (parsed as any).summary.trim()) {
				return (parsed as any).summary.trim();
			}
			if (typeof (parsed as any).executive_summary === "string" && (parsed as any).executive_summary.trim()) {
				return (parsed as any).executive_summary.trim();
			}
			if (typeof (parsed as any).text === "string" && (parsed as any).text.trim()) {
				return (parsed as any).text.trim();
			}
		}
	}

	return s;
}
