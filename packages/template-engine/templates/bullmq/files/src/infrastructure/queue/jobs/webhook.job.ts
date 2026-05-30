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
  /** True when the underlying body exceeded RESPONSE_TRUNCATE_BYTES and was cut off. */
  truncated: boolean;
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
 * Read at most `limit` bytes from a `fetch()` response body, stopping (and
 * cancelling the stream) as soon as the cap is reached. `await response.text()`
 * would buffer the entire body first — a misconfigured or hostile webhook
 * target that returns gigabytes of data would crash the worker before the
 * job result is even written. Streaming + cancel keeps memory bounded.
 */
async function readResponseBounded(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return text.length > limit
      ? { text: text.slice(0, limit), truncated: true }
      : { text, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
    // If we hit the cap but more data is buffered upstream, mark truncated.
    if (total >= limit) {
      const peek = await reader.read();
      if (!peek.done) truncated = true;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged =
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
  return { text: new TextDecoder().decode(merged), truncated };
}

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
  const { text, truncated } = await readResponseBounded(
    response,
    RESPONSE_TRUNCATE_BYTES,
  );
  return {
    status: response.status,
    responseSnippet: text,
    truncated,
    durationMs: Date.now() - start,
  };
}
