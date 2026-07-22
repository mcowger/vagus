export const EXTRACT_ARTICLE_JOB_TYPE = "extract-article";
export const STAGE_A_BULLET_JOB_TYPE = "stage-a-bullet";

export interface ExtractArticleJobData {
	runId: number;
	stageId: number;
	articleId: number;
}

export interface StageABulletJobData {
	runId: number;
	stageId: number;
	articleId: number;
}
