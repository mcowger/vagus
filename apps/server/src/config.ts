import { log } from "./log";

function parsePort(
	value: string | undefined,
	fallback: number,
	argv: string[] = process.argv,
): number {
	// The server accepts `$PORT` or `--port` only (TECHNICAL_DESIGN §13.1); it
	// does NOT import the port allocator.
	const flagIndex = argv.indexOf("--port");
	const fromFlag = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
	const raw = fromFlag ?? value;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

export interface Config {
	dbPath: string;
	port: number;
	betterAuthSecret: string;
	nodeEnv: string;
}

const DEV_DEFAULT_SECRET = "dev-insecure-secret-change-me-0123456789";

export function validateConfig(
	env: Record<string, string | undefined> = process.env,
	argv: string[] = process.argv,
): Config {
	const nodeEnv = env.NODE_ENV ?? "development";
	const isProduction = nodeEnv === "production";
	const rawSecret = env.BETTER_AUTH_SECRET;

	if (!rawSecret || rawSecret.length < 32) {
		if (isProduction) {
			throw new Error(
				"BETTER_AUTH_SECRET must be set and at least 32 characters long in production.",
			);
		}
		log.warn(
			"BETTER_AUTH_SECRET is missing or under 32 characters; using dev fallback or provided short secret.",
		);
	}

	const betterAuthSecret = rawSecret ?? DEV_DEFAULT_SECRET;

	return {
		dbPath: env.DB_PATH ?? "./data/vagus.db",
		port: parsePort(env.PORT, 4300, argv),
		betterAuthSecret,
		nodeEnv,
	};
}

export const config: Config = validateConfig();
