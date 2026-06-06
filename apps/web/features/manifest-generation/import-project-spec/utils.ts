import type { StagedPhase } from "../staged-generation-types";
import { normalizeContextName } from "@hexagen/agentic-interaction";

export interface SpecSummary {
  contextCount: number;
  aggregateCount: number;
  valueObjectCount: number;
  useCaseCount: number;
  mappingCount: number;
  eventBusSubscriptionCount: number;
}

export function extractSpecSummary(
  parsed: Record<string, unknown>,
): SpecSummary {
  const contexts = Array.isArray(parsed.bounded_contexts)
    ? (parsed.bounded_contexts as Array<Record<string, unknown>>)
    : [];

  const useCasesMap =
    parsed.use_cases && typeof parsed.use_cases === "object"
      ? (parsed.use_cases as Record<string, Array<Record<string, unknown>>>)
      : {};

  // Counts accept both the canonical shape and the rich "hexagonal" dialect
  // (domain_models.{entities,value_objects}, per-context primary_use_cases),
  // mirroring normalizeDialect in the structured-config pipeline so the review
  // reflects what will actually be imported. An explicit empty canonical array
  // (e.g. `aggregates: []`) counts as absent so it doesn't mask dialect content.
  const hasItems = (v: unknown): v is unknown[] =>
    Array.isArray(v) && v.length > 0;

  // Keep only entries that are objects with a non-empty string `name`, mirroring
  // the pipeline's `withName` so the review doesn't count nameless dialect entries
  // that normalizeDialect drops.
  const named = (v: unknown): unknown[] =>
    Array.isArray(v)
      ? v.filter(
          (x) =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as { name?: unknown }).name === "string" &&
            (x as { name: string }).name.trim().length > 0,
        )
      : [];

  const aggregateCount = contexts.reduce((sum, ctx) => {
    if (hasItems(ctx.aggregates)) {
      return (
        sum +
        (ctx.aggregates as Array<{ root?: boolean }>).filter(
          (a) => a.root !== false,
        ).length
      );
    }
    const entities = (ctx.domain_models as { entities?: unknown } | undefined)
      ?.entities;
    return sum + named(entities).length;
  }, 0);

  const valueObjectCount = contexts.reduce((sum, ctx) => {
    if (hasItems(ctx.value_objects)) {
      return sum + (ctx.value_objects as unknown[]).length;
    }
    const vos = (ctx.domain_models as { value_objects?: unknown } | undefined)
      ?.value_objects;
    return sum + named(vos).length;
  }, 0);

  // Mirror normalizeDialect exactly: a canonical top-level `use_cases[context]`
  // wins over the dialect's `primary_use_cases`, matching on the NORMALIZED
  // context identity (name or short) — not exact keys — so the review count
  // agrees with what actually imports even when the canonical key is an alias /
  // differently-cased form (#256 review).
  const canonicalKeys = new Set(
    Object.keys(useCasesMap).map((k) => normalizeContextName(k)),
  );
  const effectiveUseCases: Record<string, unknown[]> = {};
  for (const ctx of contexts) {
    const name = typeof ctx.name === "string" ? ctx.name : undefined;
    const short = typeof ctx.short === "string" ? ctx.short : undefined;
    const coveredByCanonical = [name, short]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .some((v) => canonicalKeys.has(normalizeContextName(v)));
    if (name && !coveredByCanonical) {
      effectiveUseCases[name] = named(ctx.primary_use_cases);
    }
  }
  for (const [key, arr] of Object.entries(useCasesMap)) {
    effectiveUseCases[key] = Array.isArray(arr) ? arr : [];
  }
  const useCaseCount = Object.values(effectiveUseCases).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  const mappingCount = Array.isArray(parsed.context_mappings)
    ? parsed.context_mappings.length
    : 0;

  const eventBusSubscriptionCount =
    parsed.event_bus &&
    typeof parsed.event_bus === "object" &&
    Array.isArray((parsed.event_bus as Record<string, unknown>).subscriptions)
      ? (
          (parsed.event_bus as Record<string, unknown>)
            .subscriptions as Array<unknown>
        ).length
      : 0;

  return {
    contextCount: contexts.length,
    aggregateCount,
    valueObjectCount,
    useCaseCount,
    mappingCount,
    eventBusSubscriptionCount,
  };
}

export const SPEC_STAGE_LABELS: Partial<Record<StagedPhase, string>> = {
  "stage-0": "Parsing Configuration",
  "stage-1": "Building Domain Model",
  "stage-2": "Classifying Contexts",
  "stage-3": "Mapping Ports",
  "stage-4": "Assigning Adapters",
  "stage-5": "Assembling Manifest",
  "stage-6": "Validating",
};
