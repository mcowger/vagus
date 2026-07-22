import { publicProcedure, router } from "./trpc";
import { authRouter } from "./routers/auth";
import { digestRouter } from "./routers/digest";
import { feedbackRouter } from "./routers/feedback";
import { profilesRouter } from "./routers/profiles";
import { providersRouter } from "./routers/providers";
import { runsRouter } from "./routers/runs";
import { settingsRouter } from "./routers/settings";
import { sourcesRouter } from "./routers/sources";
import { taskModelsRouter } from "./routers/task-models";
import { usageRouter } from "./routers/usage";

export const appRouter = router({
	/** Trivial liveness procedure so the web client has something to call. */
	ping: publicProcedure.query(() => ({ ok: true as const, time: Date.now() })),

	auth: authRouter,
	digest: digestRouter,
	feedback: feedbackRouter,
	profiles: profilesRouter,
	runs: runsRouter,
	settings: settingsRouter,
	sources: sourcesRouter,
	providers: providersRouter,
	taskModels: taskModelsRouter,
	usage: usageRouter,
});

export type AppRouter = typeof appRouter;
