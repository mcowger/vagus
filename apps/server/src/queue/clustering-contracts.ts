export const EMBED_ARTICLE_JOB_TYPE = "embed-article";
export const CLUSTER_RUN_JOB_TYPE = "cluster-run";
export const SCORE_USER_JOB_TYPE = "score-user";

export interface EmbedArticleJobData {
	runId: number;
	stageId: number;
	articleId: number;
}

export interface ClusterRunJobData {
	runId: number;
	stageId: number;
	profileId?: number;
}

export interface ScoreUserJobData {
	runId: number;
	stageId: number;
	userId: string;
	profileId?: number;
}
