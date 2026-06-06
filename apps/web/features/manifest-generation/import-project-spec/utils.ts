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
  // reflects what will actually be imported rather than silently reading 0.
  const aggregateCount = contexts.reduce((sum, ctx) => {
    if (Array.isArray(ctx.aggregates)) {
      const aggregatesList = ctx.aggregates as Array<{ root?: boolean }>;
      return sum + aggregatesList.filter((a) => a.root !== false).length;
    }
    const dm = ctx.domain_models as { entities?: unknown[] } | undefined;
    return sum + (dm && Array.isArray(dm.entities) ? dm.entities.length : 0);
  }, 0);

  const valueObjectCount = contexts.reduce((sum, ctx) => {
    if (Array.isArray(ctx.value_objects)) {
      return sum + (ctx.value_objects as Array<unknown>).length;
    }
    const dm = ctx.domain_models as { value_objects?: unknown[] } | undefined;
    return (
      sum +
      (dm && Array.isArray(dm.value_objects) ? dm.value_objects.length : 0)
    );
  }, 0);

  const useCaseCount =
    Object.values(useCasesMap).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    ) +
    contexts.reduce(
      (sum, ctx) =>
        sum +
        (Array.isArray(ctx.primary_use_cases)
          ? (ctx.primary_use_cases as unknown[]).length
          : 0),
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
