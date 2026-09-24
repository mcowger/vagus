import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("web HTML builds with a non-empty SPA shell and client assets", async () => {
	const outdir = await mkdtemp(join(tmpdir(), "vagus-web-build-"));

	try {
		const result = await Bun.build({
			entrypoints: [
				fileURLToPath(new URL("../../web/index.html", import.meta.url)),
			],
			target: "bun",
			outdir,
		});

		expect(result.success).toBe(true);

		const html = await result.outputs
			.find(({ path }) => path.endsWith("index.html"))
			?.text();
		expect(html).toBeDefined();
		expect(html ?? "").toContain('<base href="/" />');
		expect(html ?? "").toContain('<div id="root"></div>');
		expect(html ?? "").toContain("<script");
		expect(result.outputs.some(({ path }) => path.endsWith(".js"))).toBe(true);
		expect(result.outputs.some(({ path }) => path.endsWith(".css"))).toBe(true);
	} finally {
		await rm(outdir, { recursive: true, force: true });
	}
});
