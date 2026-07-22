import { publicProcedure, router } from "./trpc";
import { authRouter } from "./routers/auth";
import { runsRouter } from "./routers/runs";

export const appRouter = router({
	/** Trivial liveness procedure so the web client has something to call. */
	ping: publicProcedure.query(() => ({ ok: true as const, time: Date.now() })),

	auth: authRouter,
	runs: runsRouter,
});

export type AppRouter = typeof appRouter;
