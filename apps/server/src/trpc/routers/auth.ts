import { sql } from "kysely";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const authRouter = router({
	me: protectedProcedure.query(({ ctx }) => {
		return ctx.user;
	}),

	listUsers: adminProcedure.query(async ({ ctx }) => {
		const users = await sql<{
			id: string;
			name: string;
			email: string;
			role: string;
			isDisabled: number | boolean;
			createdAt: string;
			updatedAt: string;
		}>`SELECT id, name, email, role, isDisabled, createdAt, updatedAt FROM user ORDER BY createdAt ASC`.execute(
			ctx.db,
		);

		return users.rows.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			role: (u.role as "user" | "admin") ?? "user",
			isDisabled: Boolean(u.isDisabled),
			createdAt: u.createdAt,
			updatedAt: u.updatedAt,
		}));
	}),

	setRole: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				role: z.enum(["user", "admin"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			await sql`UPDATE user SET role = ${input.role}, updatedAt = ${now} WHERE id = ${input.userId}`.execute(
				ctx.db,
			);
			return { success: true };
		}),

	setDisabled: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				isDisabled: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			const disabledVal = input.isDisabled ? 1 : 0;
			await sql`UPDATE user SET isDisabled = ${disabledVal}, updatedAt = ${now} WHERE id = ${input.userId}`.execute(
				ctx.db,
			);
			return { success: true };
		}),
});
