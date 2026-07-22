import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ArticleInput {
	url: string;
	content?: string | null;
	title?: string | null;
	author?: string | null;
	imageUrl?: string | null;
	publishDate?: string | null;
}

export interface ExtractedArticle {
	title: string;
	author: string | null;
	content: string;
	readingTimeMinutes: number;
	imageUrl: string | null;
	publishDate: string | null;
}

export function cleanContent(content: string): string {
	if (!content.includes("<") || !content.includes(">")) {
		return content.trim();
	}
	try {
		const { document } = parseHTML(`<!DOCTYPE html><html><body>${content}</body></html>`);
		return (document.body?.textContent || document.textContent || content).trim();
	} catch {
		return content.trim();
	}
}

export function calculateReadingTime(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	if (words === 0) return 1;
	return Math.max(1, Math.ceil(words / 200));
}

function getMetaContent(doc: Document, selectors: string[]): string | null {
	for (const sel of selectors) {
		const el = doc.querySelector(sel);
		if (el) {
			const content = el.getAttribute("content") || el.getAttribute("href");
			if (content && content.trim().length > 0) {
				return content.trim();
			}
		}
	}
	return null;
}

export async function extractArticleContent(
	article: ArticleInput,
	htmlOverride?: string,
): Promise<ExtractedArticle> {
	if (article.content && article.content.trim().length > 0) {
		const cleaned = cleanContent(article.content);
		return {
			title: article.title?.trim() || "",
			author: article.author?.trim() || null,
			content: cleaned,
			readingTimeMinutes: calculateReadingTime(cleaned),
			imageUrl: article.imageUrl?.trim() || null,
			publishDate: article.publishDate?.trim() || null,
		};
	}

	let html: string;
	if (htmlOverride !== undefined) {
		html = htmlOverride;
	} else {
		const response = await fetch(article.url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vagus/1.0",
			},
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch article from ${article.url}: ${response.status} ${response.statusText}`);
		}
		html = await response.text();
	}

	const { document } = parseHTML(html);

	const metaTitle = getMetaContent(document as unknown as Document, [
		'meta[property="og:title"]',
		'meta[name="twitter:title"]',
	]);
	const metaAuthor = getMetaContent(document as unknown as Document, [
		'meta[name="author"]',
		'meta[property="article:author"]',
		'meta[name="twitter:creator"]',
	]);
	const imageUrl = getMetaContent(document as unknown as Document, [
		'meta[property="og:image"]',
		'meta[name="twitter:image"]',
		'link[rel="image_src"]',
	]) || article.imageUrl?.trim() || null;
	const publishDate = getMetaContent(document as unknown as Document, [
		'meta[property="article:published_time"]',
		'meta[property="og:article:published_time"]',
		'meta[name="publication_date"]',
		'meta[name="pubdate"]',
		'meta[name="dc.date"]',
		'meta[name="date"]',
	]) || article.publishDate?.trim() || null;

	const reader = new Readability(document as unknown as Document);
	const parsed = reader.parse();

	const title = parsed?.title?.trim() || metaTitle || document.title?.trim() || article.title?.trim() || "";
	const author = parsed?.byline?.trim() || metaAuthor || article.author?.trim() || null;
	const rawContent = parsed?.textContent?.trim() || document.body?.textContent?.trim() || "";
	const cleaned = cleanContent(rawContent);

	return {
		title,
		author,
		content: cleaned,
		readingTimeMinutes: calculateReadingTime(cleaned),
		imageUrl,
		publishDate,
	};
}

export async function extractArticleFromUrl(
	url: string,
	htmlOverride?: string,
): Promise<ExtractedArticle> {
	return extractArticleContent({ url }, htmlOverride);
}
