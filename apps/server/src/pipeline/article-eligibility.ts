import type { Kysely } from "kysely";
import type { Database } from "../db";

const DEFAULT_MAX_AGE_HOURS = 48;
const ARTIFACT_TITLE_PATTERNS = [
	/^- ap news$/i,
	/^(animals|mlb|pete hegseth) - ap news$/i,
	/^bbc news app$/i,
	/^tech now$/i,
];

export interface ArticleEligibilitySettings {
	maxAgeHours: number;
	filterFeedArtifacts: boolean;
}

export function isEligibleArticle(
	article: { title: string; content: string | null; stage_a_bullet: string | null; publish_date: string | null },
	settings: ArticleEligibilitySettings,
	now = new Date(),
): boolean {
	if (!article.publish_date || !article.content?.trim() && !article.stage_a_bullet?.trim()) return false;
	if (ARTIFACT_TITLE_PATTERNS.some((pattern) => pattern.test(article.title.trim()))) return !settings.filterFeedArtifacts;
	const publishedAt = new Date(article.publish_date);
	const ageMilliseconds = now.getTime() - publishedAt.getTime();
	return Number.isFinite(publishedAt.getTime()) && ageMilliseconds >= -60 * 60 * 1000 && ageMilliseconds <= settings.maxAgeHours * 60 * 60 * 1000;
}

export async function getArticleEligibilitySettings(db: Kysely<Database>): Promise<ArticleEligibilitySettings> {
	const rows = await db
		.selectFrom("system_setting")
		.select(["key", "value"])
		.where("key", "in", ["pipeline_article_max_age_hours", "pipeline_filter_feed_artifacts"])
		.execute();
	const settings = new Map(rows.map((row) => [row.key, row.value]));
	const maxAgeHours = Number(settings.get("pipeline_article_max_age_hours") ?? DEFAULT_MAX_AGE_HOURS);
	return {
		maxAgeHours: Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : DEFAULT_MAX_AGE_HOURS,
		filterFeedArtifacts: settings.get("pipeline_filter_feed_artifacts") !== "false",
	};
}
