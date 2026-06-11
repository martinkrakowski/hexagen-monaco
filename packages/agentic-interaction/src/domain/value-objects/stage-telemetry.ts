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
  /** Model that actually served this stage's LLM call(s), as reported by the
   * provider adapter after fallback resolution (e.g. "mercury-2"). Undefined
   * for deterministic stages or when the provider never reported one. */
  modelName?: string;
  /** Second model in a draft→refine cascade when one was dispatched
   * (stage 1's mercury→gpt-4o cascade today), e.g. "gpt-4o". */
  refinerModelName?: string;
}

/** Renders the model identity chip for telemetry display, e.g.
 * `[mercury-2]` or `[mercury-2 / gpt-4o]` for a draft→refine cascade.
 * Returns null when no model was resolved (deterministic stage, local run). */
export function formatModelChip(
  telemetry: Pick<StageTelemetry, "modelName" | "refinerModelName">,
): string | null {
  if (!telemetry.modelName) return null;
  return telemetry.refinerModelName
    ? `[${telemetry.modelName} / ${telemetry.refinerModelName}]`
    : `[${telemetry.modelName}]`;
}

/** Extracts the serving model name from an LLM response's metadata bag
 * (the cloud adapters record `{ provider, model }` there). Tolerant of
 * absent/foreign metadata — returns undefined rather than guessing. */
export function modelNameFromResponseMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const model = metadata?.model;
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

export function estimateTokenCount(text: string): number {
  // Conservative estimate: 1 token ≈ 4 characters for English prose
  // This avoids a tiktoken dependency in the domain layer
  return Math.ceil(text.length / 4);
}
