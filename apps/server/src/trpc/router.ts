import { publicProcedure, router } from "./trpc";
import { authRouter } from "./routers/auth";
import { profilesRouter } from "./routers/profiles";
import { providersRouter } from "./routers/providers";
import { runsRouter } from "./routers/runs";
import { sourcesRouter } from "./routers/sources";
import { taskModelsRouter } from "./routers/task-models";

export const appRouter = router({
	/** Trivial liveness procedure so the web client has something to call. */
	ping: publicProcedure.query(() => ({ ok: true as const, time: Date.now() })),

	auth: authRouter,
	profiles: profilesRouter,
	runs: runsRouter,
	sources: sourcesRouter,
	providers: providersRouter,
	taskModels: taskModelsRouter,
});

export type AppRouter = typeof appRouter;
