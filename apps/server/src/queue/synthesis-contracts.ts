export const SYNTHESIZE_CLUSTER_JOB_TYPE = "synthesize-cluster";
export const ASSEMBLE_DIGEST_JOB_TYPE = "assemble-digest";

export interface SynthesizeClusterJobData {
	runId: number;
	stageId: number;
	userId: string;
	clusterId: number;
}

export interface AssembleDigestJobData {
	runId: number;
	stageId: number;
	userId: string;
}
