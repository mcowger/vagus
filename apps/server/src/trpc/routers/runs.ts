import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { queue } from "../../queue";
import { getRun, listRuns, startRun } from "../../queue/coordinator";
import { protectedProcedure, router } from "../trpc";

export const runsRouter = router({
	startRun: protectedProcedure
		.input(
			z
				.object({
					trigger: z.enum(["cron", "manual"]).optional().default("manual"),
				})
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			const trigger = input?.trigger ?? "manual";
			return await startRun(ctx.db, queue, trigger);
		}),

	listRuns: protectedProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).optional().default(50),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const limit = input?.limit ?? 50;
			return await listRuns(ctx.db, limit);
		}),

	getRun: protectedProcedure
		.input(
			z.object({
				id: z.number(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const run = await getRun(ctx.db, input.id);
			if (!run) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Run with id ${input.id} not found`,
				});
			}
			return run;
		}),
});
