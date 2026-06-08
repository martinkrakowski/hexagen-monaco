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
      ? (parsed.use_cases as Record<string, unknown>)
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
    // Dialect: declared `domain_models.aggregates` are the roots; `entities` are
    // child entities when an aggregates list is present, else the legacy
    // entities-as-roots shape. Mirrors normalizeDialect so the review count
    // matches what actually imports.
    const dm = ctx.domain_models as
      | { aggregates?: unknown; entities?: unknown }
      | undefined;
    const dialectAggregates = named(dm?.aggregates);
    const roots =
      dialectAggregates.length > 0 ? dialectAggregates : named(dm?.entities);
    return sum + roots.length;
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
  // Only content-bearing canonical entries win over the dialect — mirroring the
  // engine's `hasUseCaseContent` (a non-empty array OR a single object). An empty
  // `use_cases: { Orders: [] }` placeholder is treated as absent so it neither
  // blocks the dialect's `primary_use_cases` (the coverage check below) nor counts
  // as zero (the merge below); an object-form `{ Orders: { name: "Charge" } }`
  // still wins and counts as one, matching `buildDomainAnalysisFromConfig`'s
  // `Array.isArray(ucs) ? ucs : [ucs]` (#260 review).
  const canonicalEntries = Object.entries(useCasesMap).filter(([, u]) =>
    Array.isArray(u) ? u.length > 0 : typeof u === "object" && u !== null,
  );
  const canonicalKeys = new Set(
    canonicalEntries.map(([k]) => normalizeContextName(k)),
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
  for (const [key, u] of canonicalEntries) {
    effectiveUseCases[key] = Array.isArray(u) ? u : [u];
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
