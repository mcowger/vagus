import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
// Bun bundles the web SPA from source (fullstack, no Vite). Track C owns the
// real app under apps/web; this import is the SPA entry served at /*.
import index from "../../web/index.html";
import { auth, initAuthSchema } from "./auth";
import { config } from "./config";
import { db } from "./db/connection";
import { migrateToLatest } from "./db/migrate";
import { log, requestLogger } from "./log";
import { queue, startWorker, stopWorker } from "./queue";
import { startScheduler, stopScheduler } from "./scheduler";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

// --- Hono app: API surface (TECHNICAL_DESIGN §2) --------------------------
const app = new Hono();

app.use("*", requestLogger());
app.use(
	"*",
	cors({
		origin: (origin) => origin ?? "*",
		credentials: true,
	}),
);

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		// @hono/trpc-server types createContext as returning a plain record; our
		// Context is structurally compatible (the router binds its real type).
		createContext: (_opts, c) =>
			createContext({ req: c.req.raw }) as unknown as Promise<
				Record<string, unknown>
			>,
	}),
);

// /api/auth/* → BetterAuth
app.all("/api/auth/*", async (c) => {
	log.info("Auth API request received", {
		method: c.req.method,
		path: c.req.path,
		cookieHeader: c.req.header("cookie") ? "present" : "missing",
		origin: c.req.header("origin") || c.req.header("referer") || "none",
		host: c.req.header("host") || "none",
		xForwardedProto: c.req.header("x-forwarded-proto") || "none",
	});
	const res = await auth.handler(c.req.raw);
	log.info("Auth API response produced", {
		path: c.req.path,
		status: res.status,
		setCookieHeader: res.headers.get("set-cookie") ? "present" : "missing",
	});
	return res;
});

// /healthz → Track D refines (structured checks). Real liveness check with DB query.
app.get("/healthz", (c) => {
	try {
		db.sqlite.query("SELECT 1").get();
		return c.json(
			{
				status: "ok",
				db: "ok",
				version: process.env.APP_VERSION ?? "dev",
				builtAt: process.env.BUILD_DATE ?? "unknown",
			},
			200,
		);
	} catch (err) {
		log.error("health check failed", { error: String(err) });
		return c.json(
			{
				status: "degraded",
				db: "error",
				version: process.env.APP_VERSION ?? "dev",
				builtAt: process.env.BUILD_DATE ?? "unknown",
			},
			503,
		);
	}
});

// --- Boot: migrate → serve → start worker ---------------------------------
async function main(): Promise<void> {
	await migrateToLatest(db.kysely);
	await initAuthSchema(auth);
	log.info("migrations applied");

	const server = Bun.serve({
		port: config.port,
		development: config.nodeEnv !== "production",
		routes: {
			// More specific routes take priority over the "/*" SPA catch-all.
			"/trpc/*": (req) => app.fetch(req),
			"/api/auth/*": (req) => app.fetch(req),
			"/healthz": (req) => app.fetch(req),
			"/*": index,
		},
	});
	log.info("server listening", { port: server.port });

	await startWorker();
	log.info("worker started");
	await startScheduler(db.kysely, queue);

	// --- Graceful shutdown (TECHNICAL_DESIGN §2) --------------------------
	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.info("shutting down", { signal });
		await server.stop(); // stop accepting new connections
		stopScheduler();
		await stopWorker(); // drain in-flight jobs
		db.close();
		log.info("shutdown complete");
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
	log.error("fatal boot error", { error: String(err) });
	process.exit(1);
});
