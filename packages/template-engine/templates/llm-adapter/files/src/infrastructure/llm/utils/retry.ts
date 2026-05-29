import { isRetryable, type LLMError } from "../errors/llm-errors";
import { parseIntSafe } from "./parse-env";
import type { Result } from "../../../../shared/result";

const DEFAULT_BASE_MS = 500;

function jitter(base: number): number {
  return Math.random() * base;
}

function backoffMs(attempt: number, base = DEFAULT_BASE_MS): number {
  return base * Math.pow(2, attempt) + jitter(base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<Result<T, LLMError>>,
  maxRetries = parseIntSafe(process.env.LLM_MAX_RETRIES, 2, 0),
): Promise<Result<T, LLMError>> {
  let attempt = 0;

  while (true) {
    const result = await fn();

    if (result.success) return result;

    const error = result.error;
    const isLast = attempt >= maxRetries;

    if (isLast || !isRetryable(error)) return result;

    const delay = error.retryAfterMs ?? backoffMs(attempt);
    await sleep(delay);
    attempt++;
  }
}
