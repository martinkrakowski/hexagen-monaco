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
 *
 * Provider scoping: the field is attached ONLY to the generic
 * OpenAI-compatible endpoint configured by the LLM_* env family
 * (LLM_BASE_URL/LLM_MODEL/LLM_API_KEY) — identified by
 * `apiKeyEnvVar === "LLM_API_KEY"`. Direct endpoints in the same fallback
 * chain must not see it: api.openai.com rejects unknown body args with a
 * non-retryable 400, which would fail the whole request before any fallback.
 */
export type ReasoningBodyField =
  | { reasoning: { enabled: false } }
  | { reasoning: { effort: "low" | "medium" | "high" } }
  | { reasoning_effort: "instant" | "low" | "medium" | "high" }
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

/**
 * Inception (Mercury) dialect of the same knob. Mercury models reason BY
 * DEFAULT (`reasoning_effort` defaults to "medium"), so an Inception
 * endpoint left unconfigured hits the F1 failure mode out of the box —
 * LLM_REASONING="disabled" maps to their no-reasoning mode, "instant".
 * Effort levels pass through unchanged. Unset/invalid → field omitted
 * (model uses its provider default, i.e. medium).
 */
export function inceptionReasoningBodyField(
  env: Record<string, string | undefined> = process.env,
): ReasoningBodyField {
  const raw = env.LLM_REASONING?.trim().toLowerCase();
  if (!raw) return {};
  if (raw === "disabled") return { reasoning_effort: "instant" };
  if (raw === "low" || raw === "medium" || raw === "high") {
    return { reasoning_effort: raw };
  }
  // Invalid values already warn once inside reasoningBodyField; calling it
  // here would double the warning paths, so just omit silently — the
  // generic provider's warning covers the misconfiguration.
  return {};
}

/**
 * Provider-scoped variant for request-body builders: returns the reasoning
 * field only for providers whose dialect we know —
 * - `apiKeyEnvVar === "LLM_API_KEY"`: the generic OpenAI-compatible endpoint
 *   (OpenRouter `reasoning` object), and
 * - `apiKeyEnvVar === "INCEPTION_API_KEY"`: Inception's Mercury endpoint
 *   (`reasoning_effort` string; reasoning is ON by default there).
 * Every other provider in the fallback chain gets `{}` regardless of
 * LLM_REASONING (api.openai.com rejects unknown body args with a
 * non-retryable 400). Spread it: `{ ...body, ...reasoningBodyFieldFor(provider) }`.
 */
export function reasoningBodyFieldFor(
  provider: { apiKeyEnvVar: string },
  env: Record<string, string | undefined> = process.env,
): ReasoningBodyField {
  if (provider.apiKeyEnvVar === "LLM_API_KEY") return reasoningBodyField(env);
  if (provider.apiKeyEnvVar === "INCEPTION_API_KEY") {
    return inceptionReasoningBodyField(env);
  }
  return {};
}
