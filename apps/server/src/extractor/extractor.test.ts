import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
	calculateReadingTime,
	cleanContent,
	extractArticleContent,
	extractArticleFromUrl,
} from "./index";

const sampleHtml = readFileSync(
	join(import.meta.dir, "fixtures", "sample_article.html"),
	"utf-8",
);

describe("extractor", () => {
	it("cleanContent strips HTML tags", () => {
		expect(cleanContent("<p>Hello <b>World</b></p>")).toBe("Hello World");
		expect(cleanContent("Plain text without HTML")).toBe("Plain text without HTML");
	});

	it("calculateReadingTime calculates reading time correctly with min 1 min", () => {
		expect(calculateReadingTime("")).toBe(1);
		expect(calculateReadingTime("Hello world")).toBe(1);
		const words300 = Array(300).fill("word").join(" ");
		expect(calculateReadingTime(words300)).toBe(2);
	});

	it("extracts content from HTML fixture using extractArticleFromUrl with htmlOverride", async () => {
		const result = await extractArticleFromUrl(
			"https://example.com/test-article",
			sampleHtml,
		);

		expect(result.title).toContain("Sample Article Title for Testing");
		expect(result.author).toBe("Jane Doe");
		expect(result.imageUrl).toBe("https://example.com/sample-image.jpg");
		expect(result.publishDate).toBe("2026-07-22T10:00:00Z");
		expect(result.content).toContain("This is the main body of the article");
		expect(result.readingTimeMinutes).toBeGreaterThanOrEqual(1);
	});

	it("skips HTTP fetch and Readability when article.content is already provided", async () => {
		const result = await extractArticleContent({
			url: "https://example.com/rss-item",
			title: "RSS Feed Title",
			author: "RSS Author",
			content: "<p>This is pre-extracted content from an RSS feed with enough words to test.</p>",
			imageUrl: "https://example.com/rss-image.png",
			publishDate: "2026-07-22T12:00:00Z",
		});

		expect(result.title).toBe("RSS Feed Title");
		expect(result.author).toBe("RSS Author");
		expect(result.content).toBe(
			"This is pre-extracted content from an RSS feed with enough words to test.",
		);
		expect(result.readingTimeMinutes).toBe(1);
		expect(result.imageUrl).toBe("https://example.com/rss-image.png");
		expect(result.publishDate).toBe("2026-07-22T12:00:00Z");
	});

	it("extracts from URL via extractArticleContent with htmlOverride", async () => {
		const result = await extractArticleContent(
			{
				url: "https://example.com/article-2",
			},
			sampleHtml,
		);

		expect(result.title).toContain("Sample Article Title for Testing");
		expect(result.author).toBe("Jane Doe");
		expect(result.content).toContain("Readability will extract this content");
	});
});
