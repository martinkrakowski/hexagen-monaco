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

/** Normalize a served model id to a stable display alias so the SAME model
 * reads identically across stages. The serving infra reports a stage's model
 * inconsistently — Stage 3 surfaced `mercury-2` (alias) while Stages 4/6
 * surfaced `inception/mercury-2-prod-h100` (provider-prefixed served id with a
 * deployment suffix) for one and the same model, which looked like two. Strip
 * the provider prefix and any `-prod-…` deployment/build suffix. */
export function normalizeModelName(model: string): string {
  const afterSlash = model.includes("/")
    ? model.slice(model.lastIndexOf("/") + 1)
    : model;
  return afterSlash.replace(/-prod-.*$/i, "");
}

/** Renders the model identity chip for telemetry display, e.g.
 * `[mercury-2]` or `[mercury-2 / gpt-4o]` for a draft→refine cascade.
 * Names are normalized so the alias and the served id read the same.
 * Returns null when no model was resolved (deterministic stage, local run). */
export function formatModelChip(
  telemetry: Pick<StageTelemetry, "modelName" | "refinerModelName">,
): string | null {
  if (!telemetry.modelName) return null;
  const primary = normalizeModelName(telemetry.modelName);
  return telemetry.refinerModelName
    ? `[${primary} / ${normalizeModelName(telemetry.refinerModelName)}]`
    : `[${primary}]`;
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
