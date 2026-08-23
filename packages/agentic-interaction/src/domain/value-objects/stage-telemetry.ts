import type { Branded } from "@hexagen/shared";

/**
 * ============================================================================
 * WHY THIS IS BRANDED AND NOT `string`
 * ============================================================================
 * `StageTelemetry.summary` is PERSISTED: the browser POSTs it to `/api/runs`
 * and it lands verbatim in `run_events.summary` (TEXT NOT NULL) on the live
 * platform DB. A plain `string` field in a persisted telemetry record is an
 * open invitation to interpolate whatever the stage happens to be holding —
 * and what stage 0 was holding is the LLM's restatement of the user's own
 * prompt.
 *
 * Shipped UI copy promises the opposite:
 *
 *   apps/web/features/landing/domain/creation-path.ts:80,82
 *     "We shallow-clone it, scan it, and delete the clone."
 *     "Nothing is retained but the scan artifacts."
 *   apps/web/features/brownfield/views/TierPickerView.tsx:56
 *   apps/web/features/brownfield/RepoEntry/RepoEntryView.tsx:93
 *   apps/web/features/brownfield/ScanProgress/GithubScanPage.tsx:208
 *     "nothing was kept"
 *
 * and ADR-0067 states the rule outright: telemetry carries metadata, never
 * user content. `repair-telemetry-store.ts` enforces that on the storage side
 * by having NO free-text column at all. This column predates that store and
 * cannot be removed without dropping run history, so the enforcement has to
 * live where the value is BUILT instead.
 *
 * Hence: `summary` is a `StageSummary`, and the only way to obtain one is the
 * {@link stageSummary} tagged template, whose interpolation slots accept
 * `number | boolean | StageSummary` and nothing else. The literal chunks of
 * the template are source text an author typed; the holes cannot be a
 * `string`, so interpolating the model's restatement of the user's prompt
 * into a summary no longer compiles.
 *
 * A `StageSummary` is still a `string` at runtime and structurally, so every
 * READER is unaffected — `StageTelemetryInput.summary: string`, the
 * `z.string()` wire schema, and the SQLite column all keep working unchanged.
 * Only PRODUCERS are constrained, which is exactly where the defect was.
 *
 * RESIDUAL, stated honestly: counts are coarse shape. "6 technologies, 2
 * ambiguities" says a prompt was detailed. It cannot name a technology, a
 * context, a repository, or a person, and no set of rows reconstructs a
 * prompt. That is the same residual `repair-telemetry-store.ts` accepts for
 * `violations_initial`, and it is the price of having run history at all.
 */
export type StageSummary = Branded<string, "StageSummary">;

/**
 * Builds a {@link StageSummary}. Tagged-template form so the safe part (the
 * author's literal text) and the unsafe part (interpolated runtime values)
 * are syntactically separated and only the latter is type-checked.
 *
 * Slots accept:
 *   - `number`  — counts, durations, sizes;
 *   - `boolean` — flags;
 *   - `StageSummary` — a fragment built by this same function, so a caller can
 *     compose (pluralisation, an optional suffix) without reaching for
 *     `string`.
 *
 * Deliberately NOT accepted: `string`. See the type doc above.
 */
export function stageSummary(
  template: TemplateStringsArray,
  ...values: readonly (number | boolean | StageSummary)[]
): StageSummary {
  let out = template[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    out += `${String(values[index])}${template[index + 1] ?? ""}`;
  }
  return out as StageSummary;
}

/** The empty fragment — for "no note to add" branches. */
export const EMPTY_STAGE_SUMMARY: StageSummary = stageSummary``;

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
  /**
   * Human-readable summary of what this stage produced — counts, flags and
   * closed-set phrases only. Branded so it can ONLY be built by
   * {@link stageSummary}; see that type's doc for why.
   */
  summary: StageSummary;
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
