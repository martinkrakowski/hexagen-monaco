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
  const contexts = (parsed.bounded_contexts ?? []) as Array<
    Record<string, unknown>
  >;
  const useCasesMap = (parsed.use_cases ?? {}) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  return {
    contextCount: contexts.length,
    aggregateCount: contexts.reduce(
      (sum, ctx) =>
        sum +
        ((ctx.aggregates as Array<Record<string, unknown>>) ?? []).filter(
          (a) => {
            const agg = a as { root?: boolean };
            return agg.root !== false;
          },
        ).length,
      0,
    ),
    valueObjectCount: contexts.reduce(
      (sum, ctx) => sum + ((ctx.value_objects as Array<unknown>) ?? []).length,
      0,
    ),
    useCaseCount: Object.values(useCasesMap).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    ),
    mappingCount: ((parsed.context_mappings as Array<unknown>) ?? []).length,
    eventBusSubscriptionCount: (
      (((parsed.event_bus as Record<string, unknown>) ?? {})
        .subscriptions as Array<unknown>) ?? []
    ).length,
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
