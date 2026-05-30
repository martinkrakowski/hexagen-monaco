import type { Job } from "bullmq";

export interface AIGenerationJobData {
  projectId: string;
  prompt: string;
  model: string;
  /** Optional webhook to ping when the generation completes. */
  callbackUrl?: string;
}

export interface AIGenerationJobResult {
  generatedContent: string;
  tokenUsage: {
    prompt: number;
    completion: number;
  };
  model: string;
}

export const AI_GENERATION_JOB_NAME = "ai-generation";


/**
 * Default queue this job runs on. Used by start-workers.ts to register
 * the handler only on the matching queue (when present in BULLMQ_QUEUE_NAMES).
 * Fall-through is "default" — the convention is that every install has a
 * "default" queue.
 */
export const AI_GENERATION_DEFAULT_QUEUE = "default";
/**
 * Stub handler — replace with your LLM client (the llm-adapter template
 * exposes a typed port). Long-running by nature; expects a callback URL
 * for client notification on completion.
 */
export async function processAIGenerationJob(
  job: Job<AIGenerationJobData>,
): Promise<AIGenerationJobResult> {
  await job.log(
    `ai-generation project=${job.data.projectId} model=${job.data.model}`,
  );
  await job.updateProgress(20);

  // TODO: replace stub with a real LLM call (consider the llm-adapter template).
  const generatedContent = "";

  await job.updateProgress(100);

  return {
    generatedContent,
    tokenUsage: { prompt: 0, completion: 0 },
    model: job.data.model,
  };
}
