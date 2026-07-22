import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

// TODO(Track A): refine these guards once BetterAuth populates ctx.user. The
// seam (exported `protectedProcedure` / `adminProcedure`) stays stable.
const requireUser = middleware(({ ctx, next }) => {
	if (!ctx.user || ctx.user.isDisabled) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireAdmin = middleware(({ ctx, next }) => {
	if (!ctx.user || ctx.user.isDisabled) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	if (ctx.user.role !== "admin") {
		throw new TRPCError({ code: "FORBIDDEN" });
	}
	return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = publicProcedure.use(requireUser);
export const adminProcedure = publicProcedure.use(requireAdmin);
