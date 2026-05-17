export interface SpecSummary {
  contextCount: number;
  aggregateCount: number;
  valueObjectCount: number;
  useCaseCount: number;
  mappingCount: number;
  eventBusSubscriptionCount: number;
}

interface BoundedContext {
  aggregates?: unknown[];
  value_objects?: unknown[];
}

interface UseCases {
  [contextName: string]: unknown[];
}

interface EventBus {
  subscriptions?: unknown[];
}

interface ParsedSpec {
  bounded_contexts?: BoundedContext[];
  use_cases?: UseCases;
  context_mappings?: unknown[];
  event_bus?: EventBus;
}

export function extractSpecSummary(spec: ParsedSpec): SpecSummary {
  const contexts = spec.bounded_contexts ?? [];

  return {
    contextCount: contexts.length,
    aggregateCount: contexts.reduce(
      (sum, ctx) => sum + (ctx.aggregates?.length ?? 0),
      0,
    ),
    valueObjectCount: contexts.reduce(
      (sum, ctx) => sum + (ctx.value_objects?.length ?? 0),
      0,
    ),
    useCaseCount: Object.values(spec.use_cases ?? {}).reduce(
      (sum, cases) => sum + (Array.isArray(cases) ? cases.length : 0),
      0,
    ),
    mappingCount: spec.context_mappings?.length ?? 0,
    eventBusSubscriptionCount: spec.event_bus?.subscriptions?.length ?? 0,
  };
}
