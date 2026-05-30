import type { Job } from "bullmq";

export interface WebhookJobData {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body: unknown;
  /** Number of attempts already made; surfaced to the worker for exponential backoff. */
  attempt?: number;
}

export interface WebhookJobResult {
  status: number;
  responseSnippet: string;
  durationMs: number;
}

export const WEBHOOK_JOB_NAME = "webhook";


/**
 * Default queue this job runs on. Used by start-workers.ts to register
 * the handler only on the matching queue (when present in BULLMQ_QUEUE_NAMES).
 * Fall-through is "default" — the convention is that every install has a
 * "default" queue.
 */
export const WEBHOOK_DEFAULT_QUEUE = "default";
const RESPONSE_TRUNCATE_BYTES = 512;

/**
 * Dispatches an outbound webhook with strict body-size truncation on the
 * response we keep for the job result. The full response is NOT logged so a
 * malicious target can't blow the job-result store.
 */
export async function processWebhookJob(
  job: Job<WebhookJobData>,
): Promise<WebhookJobResult> {
  const start = Date.now();
  await job.log(`webhook ${job.data.method} ${job.data.url}`);
  const response = await fetch(job.data.url, {
    method: job.data.method,
    headers: {
      "content-type": "application/json",
      ...(job.data.headers ?? {}),
    },
    body: JSON.stringify(job.data.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    responseSnippet: text.slice(0, RESPONSE_TRUNCATE_BYTES),
    durationMs: Date.now() - start,
  };
}
