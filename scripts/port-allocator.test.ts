import { describe, expect, test } from "bun:test";
import {
	allocatePort,
	DEFAULT_RANGE,
	parseRange,
	resolveRange,
	resolveServerPort,
} from "./port-allocator";

describe("parseRange", () => {
	test("parses a valid range", () => {
		expect(parseRange("4300-4399")).toEqual({ start: 4300, end: 4399 });
	});

	test("tolerates surrounding whitespace", () => {
		expect(parseRange("  3000 - 4000 ")).toEqual({ start: 3000, end: 4000 });
	});

	test.each(["", "abc", "4000", "5000-4000", "0-10", "70000-80000"])(
		"rejects %p",
		(spec) => {
			expect(() => parseRange(spec)).toThrow();
		},
	);
});

describe("resolveRange", () => {
	test("defaults when env is unset", () => {
		expect(resolveRange({})).toEqual(parseRange(DEFAULT_RANGE));
	});

	test("honors PASEO_PORT_RANGE", () => {
		expect(resolveRange({ PASEO_PORT_RANGE: "5000-5010" })).toEqual({
			start: 5000,
			end: 5010,
		});
	});
});

describe("allocatePort", () => {
	const range = { start: 4300, end: 4399 };

	test("is deterministic for the same inputs", () => {
		const a = allocatePort({ service: "web", branch: "main", range });
		const b = allocatePort({ service: "web", branch: "main", range });
		expect(a).toBe(b);
	});

	test("always falls within the range", () => {
		const branches = ["main", "feature/auth", "fix/1", "", "very/long/branch"];
		for (const branch of branches) {
			const port = allocatePort({ service: "web", branch, range });
			expect(port).toBeGreaterThanOrEqual(range.start);
			expect(port).toBeLessThanOrEqual(range.end);
		}
	});

	test("different branches generally get different ports", () => {
		const ports = new Set(
			["main", "feature/auth", "fix/bug", "docs/readme", "chore/deps"].map(
				(branch) => allocatePort({ service: "web", branch, range }),
			),
		);
		// Not guaranteed unique, but a decent hash should spread these out.
		expect(ports.size).toBeGreaterThan(3);
	});

	test("different services on the same branch differ", () => {
		const web = allocatePort({ service: "web", branch: "main", range });
		const api = allocatePort({ service: "api", branch: "main", range });
		expect(web).not.toBe(api);
	});
});

describe("resolveServerPort", () => {
	test("prefers a valid injected PASEO_PORT", () => {
		expect(resolveServerPort("web", { PASEO_PORT: "4321" })).toBe(4321);
	});

	test("falls back to the allocator for an invalid PASEO_PORT", () => {
		const env = { PASEO_PORT: "not-a-port", PASEO_BRANCH_NAME: "main" };
		const expected = allocatePort({
			service: "web",
			branch: "main",
			range: resolveRange(env),
		});
		expect(resolveServerPort("web", env)).toBe(expected);
	});

	test("uses PASEO_BRANCH_NAME when no port is injected", () => {
		const env = { PASEO_BRANCH_NAME: "feature/x" };
		const expected = allocatePort({
			service: "web",
			branch: "feature/x",
			range: resolveRange(env),
		});
		expect(resolveServerPort("web", env)).toBe(expected);
	});

	test("agrees with the portScript path for the same branch", () => {
		const env = { PASEO_BRANCH_NAME: "release/1.2" };
		const viaServer = resolveServerPort("web", env);
		const viaScript = allocatePort({
			service: "web",
			branch: "release/1.2",
			range: resolveRange(env),
		});
		expect(viaServer).toBe(viaScript);
	});
});
