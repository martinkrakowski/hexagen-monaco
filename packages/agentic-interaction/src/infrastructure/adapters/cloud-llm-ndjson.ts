/**
 * Structured-output enforcement for NDJSON stages on providers that support
 * `response_format: { type: "json_schema" }` (currently Inception/Mercury).
 *
 * Why this exists (empirical probes, 2026-06-10): mercury-2's two observed
 * failure modes both trace to free-text NDJSON emission — at
 * `reasoning_effort: instant` it breaks the NDJSON format outright (stage-2
 * deaths), and at `low` it under-decomposes (1-context collapse on 5/8 golden
 * prompts). The same prompt with a schema-enforced response produced 8 clean
 * contexts one-shot. BUT the schema must describe an **array of objects**:
 * probing a single-object schema showed it overrides the prompt's NDJSON
 * instructions entirely and truncates the response to ONE object.
 *
 * Mechanics: the stage attaches `request.ndjsonLineSchema` (the shape of ONE
 * line); the body builder wraps it in `{ lines: [...] }` for the wire; the
 * response unwrapper converts the returned JSON array back into NDJSON text
 * so the stages' existing line-oriented parsers (and their retry loops) work
 * unchanged. Scoped by `apiKeyEnvVar === "INCEPTION_API_KEY"` like
 * `reasoningBodyFieldFor`/`clampTemperatureFor`; every other provider's
 * request bodies stay byte-identical.
 */

/** Spread into the request body:
 * `{ ...body, ...ndjsonResponseFormatFor(provider, request) }`. */
export function ndjsonResponseFormatFor(
  provider: { apiKeyEnvVar: string },
  request: { ndjsonLineSchema?: Record<string, unknown> },
): Record<string, never> | { response_format: Record<string, unknown> } {
  if (provider.apiKeyEnvVar !== "INCEPTION_API_KEY") return {};
  if (!request.ndjsonLineSchema) return {};
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ndjson_lines",
        description:
          "Every line of the NDJSON output, as elements of the `lines` array.",
        schema: {
          type: "object",
          properties: {
            lines: { type: "array", items: request.ndjsonLineSchema },
          },
          required: ["lines"],
        },
      },
    },
  };
}

/**
 * Convert a schema-enforced response (`{"lines":[...]}` — or, defensively, a
 * bare top-level array) back into NDJSON text. Returns `null` when the
 * content is not that shape (e.g. the model ignored the schema and emitted
 * NDJSON anyway) — callers must fall back to the raw content so the stage
 * parsers and their retry loops see what the model actually said.
 */
export function unwrapNdjsonLines(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    const lines = Array.isArray(parsed)
      ? parsed
      : (parsed as { lines?: unknown })?.lines;
    if (!Array.isArray(lines)) return null;
    return lines.map((line) => JSON.stringify(line)).join("\n");
  } catch {
    return null;
  }
}
