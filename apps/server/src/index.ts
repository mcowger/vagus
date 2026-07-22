import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
// Bun bundles the web SPA from source (fullstack, no Vite). Track C owns the
// real app under apps/web; this import is the SPA entry served at /*.
import index from "../../web/index.html";
import { auth, initAuthSchema } from "./auth";
import { config } from "./config";
import { db } from "./db/connection";
import { migrateToLatest } from "./db/migrate";
import { log, requestLogger } from "./log";
import { startWorker, stopWorker } from "./queue";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

// --- Hono app: API surface (TECHNICAL_DESIGN §2) --------------------------
const app = new Hono();

app.use("*", requestLogger());

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

// /api/auth/* → BetterAuth (Track A owns ./auth; stub returns 501 for now).
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// /healthz → Track D refines (structured checks). Real liveness check with DB query.
app.get("/healthz", (c) => {
	try {
		db.sqlite.query("SELECT 1").get();
		return c.json({ status: "ok", db: "ok" }, 200);
	} catch (err) {
		log.error("health check failed", { error: String(err) });
		return c.json({ status: "degraded", db: "error" }, 503);
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

	// --- Graceful shutdown (TECHNICAL_DESIGN §2) --------------------------
	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.info("shutting down", { signal });
		await server.stop(); // stop accepting new connections
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
