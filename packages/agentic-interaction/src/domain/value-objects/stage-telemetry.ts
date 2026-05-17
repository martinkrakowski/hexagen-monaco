export interface StageTelemetry {
  stage: number;
  label: string;
  durationMs: number;
  /** True if this stage made an LLM API call */
  usedLLM: boolean;
  /** Number of retry attempts before success (0 = first attempt succeeded) */
  retryCount: number;
  /** Estimated input tokens sent to the LLM (0 for synchronous stages) */
  inputTokensEstimate: number;
  /** Actual output tokens received from the LLM (0 for synchronous stages) */
  outputTokensActual: number;
  /** Whether this stage result was served from cache */
  servedFromCache: boolean;
  /** Human-readable summary of what this stage produced */
  summary: string;
}

export function estimateTokenCount(text: string): number {
  // Conservative estimate: 1 token ≈ 4 characters for English prose
  // This avoids a tiktoken dependency in the domain layer
  return Math.ceil(text.length / 4);
}
