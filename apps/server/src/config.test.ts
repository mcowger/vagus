import { expect, test } from "bun:test";
import { config, validateConfig } from "./config";

test("config export is loaded with defaults", () => {
	expect(config.dbPath).toBeDefined();
	expect(config.port).toBeGreaterThan(0);
	expect(config.betterAuthSecret).toBeDefined();
	expect(config.nodeEnv).toBeDefined();
});

test("validateConfig passes with valid 32+ char secret", () => {
	const validSecret = "a".repeat(32);
	const res = validateConfig({
		NODE_ENV: "production",
		BETTER_AUTH_SECRET: validSecret,
		PORT: "5000",
	});
	expect(res.betterAuthSecret).toBe(validSecret);
	expect(res.nodeEnv).toBe("production");
	expect(res.port).toBe(5000);
});

test("validateConfig throws in production when secret is missing or short", () => {
	expect(() =>
		validateConfig({
			NODE_ENV: "production",
			BETTER_AUTH_SECRET: "short-secret",
		}),
	).toThrow();

	expect(() =>
		validateConfig({
			NODE_ENV: "production",
		}),
	).toThrow();
});

test("validateConfig warns and allows fallback or short secret in dev", () => {
	const shortDev = validateConfig({
		NODE_ENV: "development",
		BETTER_AUTH_SECRET: "short",
	});
	expect(shortDev.betterAuthSecret).toBe("short");

	const fallbackDev = validateConfig({
		NODE_ENV: "development",
	});
	expect(fallbackDev.betterAuthSecret).toBe(
		"dev-insecure-secret-change-me-0123456789",
	);
});
