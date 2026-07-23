import { expect, test } from "bun:test";
import { stripCitationTags } from "./DigestReader";

test("stripCitationTags removes citation lists without leaving separators", () => {
	expect(stripCitationTags("Agreement reached [art_1, art_282, art_437].")).toBe("Agreement reached.");
	expect(stripCitationTags("Agreement reached [art_1, art_282, art_437],.")).toBe("Agreement reached.");
});
