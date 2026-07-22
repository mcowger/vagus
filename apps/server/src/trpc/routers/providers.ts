import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const providersRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		return await ctx.db.selectFrom("provider_config").selectAll().execute();
	}),

	upsert: adminProcedure
		.input(
			z.object({
				provider: z.string().min(1),
				apiKey: z.string().nullable().optional(),
				enabled: z.boolean().optional().default(true),
				config: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const now = new Date().toISOString();
			const existing = await ctx.db
				.selectFrom("provider_config")
				.select("id")
				.where("provider", "=", input.provider)
				.executeTakeFirst();

			if (existing) {
				await ctx.db
					.updateTable("provider_config")
					.set({
						api_key: input.apiKey !== undefined ? input.apiKey : undefined,
						enabled: input.enabled ? 1 : 0,
						config: input.config !== undefined ? input.config : undefined,
						updated_at: now,
					})
					.where("id", "=", existing.id)
					.execute();
				return { success: true, id: existing.id };
			}

			const inserted = await ctx.db
				.insertInto("provider_config")
				.values({
					provider: input.provider,
					api_key: input.apiKey ?? null,
					enabled: input.enabled ? 1 : 0,
					config: input.config ?? null,
					created_at: now,
					updated_at: now,
				})
				.returning(["id"])
				.executeTakeFirstOrThrow();

			return { success: true, id: inserted.id };
		}),

	delete: adminProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.deleteFrom("provider_config")
				.where("id", "=", input.id)
				.execute();
			return { success: true };
		}),

	getModels: adminProcedure
		.input(z.object({ provider: z.string() }))
		.query(async ({ ctx, input }) => {
			const pConfig = await ctx.db
				.selectFrom("provider_config")
				.selectAll()
				.where("provider", "=", input.provider)
				.executeTakeFirst();

			if (!pConfig) {
				return [];
			}

			let baseUrl = "https://api.openai.com/v1";
			if (pConfig.config) {
				try {
					const parsed = JSON.parse(pConfig.config);
					if (parsed.baseUrl) baseUrl = parsed.baseUrl;
				} catch {}
			}

			const apiKey = pConfig.api_key;
			const base = baseUrl.replace(/\/+$/, "");
			const endpoint = base.endsWith("/models") ? base : `${base}/models`;

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (apiKey) {
					headers["Authorization"] = `Bearer ${apiKey}`;
				}

				const res = await fetch(endpoint, { headers });
				if (!res.ok) {
					return [];
				}

				const data = (await res.json()) as any;
				const list = Array.isArray(data) ? data : data?.data || [];

				return list.map((item: any) => ({
					id: String(item.id || item.name),
					name: item.name || item.id,
					modality: item.architecture?.modality || item.modality || null,
					inputModalities: item.architecture?.input_modalities || item.input_modalities || [],
					outputModalities: item.architecture?.output_modalities || item.output_modalities || [],
				}));
			} catch {
				return [];
			}
		}),
});
