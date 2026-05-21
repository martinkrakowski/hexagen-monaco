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

  const aggregateCount = contexts.reduce((sum, ctx) => {
    if (!Array.isArray(ctx.aggregates)) {
      return sum;
    }
    const aggregatesList = ctx.aggregates as Array<Record<string, unknown>>;
    return (
      sum +
      aggregatesList.filter((a) => {
        const agg = a as { root?: boolean };
        return agg.root !== false;
      }).length
    );
  }, 0);

  const valueObjectCount = contexts.reduce((sum, ctx) => {
    return (
      sum +
      (Array.isArray(ctx.value_objects)
        ? (ctx.value_objects as Array<unknown>).length
        : 0)
    );
  }, 0);

  const useCaseCount = Object.values(useCasesMap).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
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
