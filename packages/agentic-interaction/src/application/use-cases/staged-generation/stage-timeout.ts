/**
 * Per-attempt LLM timeouts for the staged-generation stages.
 *
 * Each stage wraps its model call in an AbortController that fires after the
 * ceiling for its weight class. On a timeout the stage FAILS FAST — it does not
 * retry, because re-issuing the same prompt to an overloaded or stuck model just
 * repeats the wait (the previous behaviour multiplied the ceiling across
 * MAX_RETRY_ATTEMPTS). Genuine transient failures (network blips, malformed
 * output) still retry as before; only the timeout path short-circuits. Callers
 * surface the resulting error with a Retry / "continue as description"
 * affordance, so the worst case is one ceiling's wait, not an effectively
 * infinite "Converting…" spinner (the prior flat 30-minute value read as a hang
 * on the loose-spec conversion path).
 *
 * Two weight classes, because one value cannot fit both a ≤1600-token call and
 * an 8000-token one: short-output stages get a tight ceiling so a stuck model
 * surfaces quickly; large-output stages get a generous ceiling so a slow but
 * progressing local model is not killed mid-generation. Fail-fast keeps the
 * generous ceiling safe — it is a one-shot wait, never multiplied.
 */

/** Short-output stages: prompt-normalization, context-classification, validation-review (≤800 maxTokens) and domain-extraction (1600 since the decomposition requirement). */
export const STAGE_ATTEMPT_TIMEOUT_MS = 180_000; // 3 minutes per attempt

/** Large-output stages: loose-spec conversion (8000 maxTokens) and adapter assignment (4096). */
export const LARGE_OUTPUT_STAGE_TIMEOUT_MS = 480_000; // 8 minutes per attempt

/**
 * Port mapping streams partial output and salvages whatever JSON objects arrived
 * before the deadline (see `runSingleAttempt`), so its ceiling is a "use what you
 * have" cut-off rather than a hard failure — it deliberately keeps a shorter,
 * separate value and does NOT fail fast.
 */
export const STAGE_STREAMING_TIMEOUT_MS = 120_000; // 2 minutes per attempt

/**
 * Build the fail-fast error surfaced when a stage's per-attempt timeout fires.
 * Kept here so the message (and the "no retry on timeout" contract) lives next
 * to the ceilings it reports.
 */
export function stageTimeoutError(label: string, timeoutMs: number): Error {
  const seconds = Math.round(timeoutMs / 1000);
  return new Error(
    `${label} timed out after ${seconds}s. The model may be overloaded — ` +
      `retry, or continue as a plain description.`,
  );
}
