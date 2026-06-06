/**
 * Per-attempt LLM timeout for the staged-generation stages. Each stage wraps its
 * model call in an AbortController that fires after this long; `retryWithEscalation`
 * may multiply it across attempts.
 *
 * Kept to an interactive ceiling: a slow or stuck model now surfaces a retryable
 * error in a few minutes instead of presenting as an effectively-infinite
 * "Converting…" spinner. The previous 30-minute value read to users as a hang
 * (e.g. the loose-spec conversion path for a spec that fails strict YAML parsing).
 */
export const STAGE_ATTEMPT_TIMEOUT_MS = 180_000; // 3 minutes per attempt
