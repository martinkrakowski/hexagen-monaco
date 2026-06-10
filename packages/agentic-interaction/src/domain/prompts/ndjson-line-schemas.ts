/**
 * JSON Schemas for ONE line of each NDJSON stage's output, attached to
 * requests as `ndjsonLineSchema` so providers with structured-output support
 * (currently Inception/Mercury via `response_format`) can enforce the shape.
 * Providers without that support ignore the field entirely.
 *
 * Design constraints (empirical, 2026-06-10 mercury-2 probes):
 * - The adapter wraps these in `{ lines: [...] }` — see cloud-llm-ndjson.ts
 *   for why a single-object schema is self-defeating (it overrides the
 *   prompt's NDJSON instruction and truncates the response to ONE object).
 * - Deliberately PERMISSIVE: minimal `required`, no `anyOf` discriminated
 *   unions (provider schema support is uneven), no `additionalProperties:
 *   false`. Validation is not the goal — the stage parsers already guard
 *   every field; the schema's job is forcing decomposed, line-shaped output.
 * - Field names/enums mirror the NDJSON examples in
 *   generate-manifest.prompt.ts and the parsers in the stage use-cases —
 *   keep all three in sync.
 */

/** Stage 0 (prompt normalization): typed key/value facts. */
export const STAGE0_NDJSON_LINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "intent",
        "technology",
        "pattern",
        "ambiguity",
        "projectName",
        "isStructuredConfig",
      ],
    },
    // string for every type except isStructuredConfig (boolean) — left
    // untyped because union scalar types are the kind of schema feature
    // structured-output implementations disagree on.
    value: {},
  },
  required: ["type", "value"],
};

/** Stage 1 (domain extraction): property superset over the seven line
 * variants (verb/noun/subdomain carry `value`; the rest carry `name` plus
 * variant-specific fields). */
export const STAGE1_NDJSON_LINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "verb",
        "noun",
        "subdomain",
        "aggregateRoot",
        "entity",
        "valueObject",
        "domainEvent",
        "useCase",
      ],
    },
    value: { type: "string" },
    name: { type: "string" },
    subdomain: { type: "string" },
    identityFields: { type: "array", items: { type: "string" } },
    parentAggregate: { type: "string" },
    rules: { type: "string" },
    emitter: { type: "string" },
    trigger: { type: "string" },
    actor: { type: "string" },
    commandName: { type: "string" },
  },
  required: ["type"],
};

/** Stage 2 (context classification): one verdict per candidate context.
 * This is the stage whose free-text NDJSON collapsed on mercury-2 (1-context
 * decomposition on 5/8 golden prompts; schema-enforced probe yielded 8). */
export const STAGE2_NDJSON_LINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["accepted", "rejected", "uncertain"],
    },
    name: { type: "string" },
    reasoning: { type: "string" },
    contextType: {
      type: "string",
      enum: ["core", "supporting", "generic", "shared-kernel"],
    },
    responsibility: { type: "string" },
    aggregateRoots: { type: "array", items: { type: "string" } },
    useCaseNames: { type: "array", items: { type: "string" } },
    eventsPublished: { type: "array", items: { type: "string" } },
    recommendation: {
      type: "string",
      enum: [
        "accept-as-core",
        "accept-as-supporting",
        "accept-as-generic",
        "accept-as-shared-kernel",
        "reject",
      ],
    },
  },
  required: ["status", "name", "reasoning"],
};
