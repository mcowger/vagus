import { sql } from "kysely";
import { z } from "zod";
import { auth } from "../../auth";
import { adminProcedure, router } from "../trpc";

export const apiKeysRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		const rows = await sql<{
			id: string;
			name: string | null;
			start: string | null;
			enabled: number | boolean;
			createdAt: string;
		}>`SELECT id, name, start, enabled, createdAt FROM apikey WHERE referenceId = ${ctx.user.id} ORDER BY createdAt DESC`.execute(
			ctx.db,
		);

		return rows.rows.map((k) => ({
			id: k.id,
			name: k.name,
			start: k.start,
			enabled: Boolean(k.enabled),
			createdAt: k.createdAt,
		}));
	}),

	create: adminProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			// The apiKey plugin is registered via `as any`, so its endpoints are not
			// reflected in the inferred `auth.api` type.
			const created = await (auth.api as any).createApiKey({
				body: {
					name: input.name,
					userId: ctx.user.id,
				},
			});

			return { id: created.id, key: created.key };
		}),

	revoke: adminProcedure
		.input(z.object({ keyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await sql`DELETE FROM apikey WHERE id = ${input.keyId} AND referenceId = ${ctx.user.id}`.execute(
				ctx.db,
			);
			return { success: true };
		}),
});
