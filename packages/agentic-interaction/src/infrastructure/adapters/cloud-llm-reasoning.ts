/**
 * Optional reasoning-mode control for reasoning-capable models routed through
 * OpenAI-compatible providers (the OpenRouter `reasoning` body field).
 *
 * Sourced from the LLM_REASONING env var: "disabled" | "low" | "medium" |
 * "high". Unset (the default everywhere, prod included) → the field is
 * omitted entirely, so existing callers and non-reasoning models see
 * byte-identical request bodies.
 *
 * Why this exists (baseline findings F1, docs/planning/
 * staged-generation-baseline-findings.md): reasoning-default models bill
 * thinking as completion tokens against the stage maxTokens caps (800 on
 * stages 0/1/2/6) → finishReason "length" with empty content and a 0% run.
 * Disabling (or bounding) reasoning per-run makes such models benchmarkable
 * without touching the caps.
 */
export type ReasoningBodyField =
  | { reasoning: { enabled: false } }
  | { reasoning: { effort: "low" | "medium" | "high" } }
  | Record<string, never>;

let warnedInvalid = false;

/** Spread the result into an OpenAI-compatible request body:
 * `{ ...body, ...reasoningBodyField() }`. */
export function reasoningBodyField(
  env: Record<string, string | undefined> = process.env,
): ReasoningBodyField {
  const raw = env.LLM_REASONING?.trim().toLowerCase();
  if (!raw) return {};
  if (raw === "disabled") return { reasoning: { enabled: false } };
  if (raw === "low" || raw === "medium" || raw === "high") {
    return { reasoning: { effort: raw } };
  }
  // Loud once: a typo here (e.g. "off") silently reverts a reasoning model
  // to its provider default — the exact F1 failure mode this knob prevents.
  if (!warnedInvalid) {
    warnedInvalid = true;
    // eslint-disable-next-line no-console -- operator-facing misconfiguration warning; no logger port at this layer
    console.warn(
      `LLM_REASONING="${raw}" is not one of disabled|low|medium|high — ` +
        `ignoring it (reasoning field omitted; model uses its provider default).`,
    );
  }
  return {};
}
