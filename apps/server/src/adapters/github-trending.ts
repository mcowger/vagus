import { parseHTML } from "linkedom";
import type { Selectable } from "kysely";
import type { SourceTable } from "../db/schema";
import type { FetchedSourceItem, SourceAdapter } from "./types";

export class GitHubTrendingAdapter implements SourceAdapter {
	async fetchItems(
		source: Selectable<SourceTable>,
		options?: { timeoutMs?: number },
	): Promise<FetchedSourceItem[]> {
		let targetUrl = source.url?.trim();
		if (!targetUrl) {
			let language: string | undefined;
			if (source.config) {
				try {
					const config =
						typeof source.config === "string"
							? JSON.parse(source.config)
							: source.config;
					if (config && typeof config.language === "string" && config.language.trim()) {
						language = config.language.trim();
					}
				} catch {
					// Ignore invalid JSON in config
				}
			}
			targetUrl = language
				? `https://github.com/trending/${encodeURIComponent(language)}`
				: "https://github.com/trending";
		}

		const timeoutMs = options?.timeoutMs ?? 10000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(targetUrl, {
				headers: {
					"User-Agent": "Vagus/1.0 News Digest Bot (+https://vagus.local)",
					Accept: "text/html,application/xhtml+xml",
				},
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(
					`Failed to fetch GitHub Trending from ${targetUrl}: HTTP ${res.status}`,
				);
			}

			const htmlText = await res.text();
			return this.parseHtml(htmlText);
		} finally {
			clearTimeout(timeoutId);
		}
	}

	parseHtml(htmlText: string): FetchedSourceItem[] {
		const { document } = parseHTML(htmlText);
		const rows = document.querySelectorAll("article.Box-row");
		const items: FetchedSourceItem[] = [];

		for (const row of Array.from(rows)) {
			const titleAnchor =
				row.querySelector("h1 a, h2 a, h3 a") || row.querySelector("a[href^='/']");
			if (!titleAnchor) continue;

			const href = titleAnchor.getAttribute("href") || "";
			let path = href;
			if (path.startsWith("https://github.com")) {
				path = path.replace("https://github.com", "");
			}
			const cleanPath = path
				.split("?")[0]
				.split("#")[0]
				.replace(/^\/+|\/+$/g, "");
			const parts = cleanPath.split("/");
			if (parts.length < 2) continue;

			const owner = parts[0];
			const repo = parts[1];
			const repoName = `${owner}/${repo}`;
			const url = `https://github.com/${repoName}`;
			const identityKey = `github-trending-${repoName.replace("/", "-")}`;

			const pEl = row.querySelector("p");
			const descriptionText = pEl ? pEl.textContent.trim().replace(/\s+/g, " ") : null;
			const description = descriptionText && descriptionText.length > 0 ? descriptionText : null;

			// Extract primary language and star counts if available
			const langEl = row.querySelector('[itemprop="programmingLanguage"]');
			const _language = langEl ? langEl.textContent.trim() : null;

			const starsEl = row.querySelector('a[href$="/stargazers"], a[href*="/stargazers"]');
			const _stars = starsEl ? starsEl.textContent.trim().replace(/\s+/g, " ") : null;

			const starsPeriodEl = row.querySelector(
				"span.float-sm-right, span.d-inline-block.float-sm-right",
			);
			const _starsPeriod = starsPeriodEl
				? starsPeriodEl.textContent.trim().replace(/\s+/g, " ")
				: null;

			items.push({
				identityKey,
				title: repoName,
				url,
				author: owner,
				content: description,
			});
		}

		return items;
	}
}
