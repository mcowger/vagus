import { publicProcedure, router } from "./trpc";
import { authRouter } from "./routers/auth";
import { providersRouter } from "./routers/providers";
import { runsRouter } from "./routers/runs";
import { sourcesRouter } from "./routers/sources";

export const appRouter = router({
	/** Trivial liveness procedure so the web client has something to call. */
	ping: publicProcedure.query(() => ({ ok: true as const, time: Date.now() })),

	auth: authRouter,
	runs: runsRouter,
	sources: sourcesRouter,
	providers: providersRouter,
});

export type AppRouter = typeof appRouter;
