import type { StagedPhase } from "../staged-generation-types";

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
    return sum + (hasItems(entities) ? entities.length : 0);
  }, 0);

  const valueObjectCount = contexts.reduce((sum, ctx) => {
    if (hasItems(ctx.value_objects)) {
      return sum + (ctx.value_objects as unknown[]).length;
    }
    const vos = (ctx.domain_models as { value_objects?: unknown } | undefined)
      ?.value_objects;
    return sum + (hasItems(vos) ? vos.length : 0);
  }, 0);

  // Mirror normalizeDialect's merge so the review matches what imports: per
  // context, a canonical top-level `use_cases[context]` wins over the dialect's
  // `primary_use_cases` (a spec carrying both is not double-counted).
  const effectiveUseCases: Record<string, unknown[]> = {};
  for (const ctx of contexts) {
    const name = typeof ctx.name === "string" ? ctx.name : undefined;
    const short = typeof ctx.short === "string" ? ctx.short : undefined;
    // Canonical use_cases win (matching normalizeDialect), including when keyed by
    // a context alias (name vs short). Exact-key match here; the pipeline uses a
    // normalized match — close enough for an advisory count.
    const coveredByCanonical =
      (!!name && name in useCasesMap) || (!!short && short in useCasesMap);
    if (name && !coveredByCanonical && Array.isArray(ctx.primary_use_cases)) {
      effectiveUseCases[name] = ctx.primary_use_cases as unknown[];
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
