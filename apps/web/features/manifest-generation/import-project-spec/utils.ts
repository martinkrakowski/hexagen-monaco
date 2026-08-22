import type { StagedPhase } from "../../../app/lib/staged-generation-types";
import { normalizeContextName } from "@hexagen/agentic-interaction";
import { isManifestDialect } from "@hexagen/agentic-interaction/manifest-dialect";

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
  const named = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v)
      ? (v.filter(
          (x) =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as { name?: unknown }).name === "string" &&
            (x as { name: string }).name.trim().length > 0,
        ) as Array<Record<string, unknown>>)
      : [];

  // The Hexagen manifest dialect names its contexts `contexts:` — count those
  // so the review screen doesn't show "0 contexts" for a file the pipeline
  // imports deterministically (mapManifestDialect). Domain counts below stay 0
  // for that dialect (it carries ports/adapters, not aggregates/use cases).
  // Require a NON-EMPTY `bounded_contexts` before treating it as canonical,
  // matching isManifestDialect — otherwise `bounded_contexts: []` alongside a
  // populated `contexts:` (which the server maps) would report 0 contexts,
  // reintroducing the "0 contexts" mismatch (CodeRabbit #409).
  const contexts = hasItems(parsed.bounded_contexts)
    ? (parsed.bounded_contexts as Array<Record<string, unknown>>)
    : isManifestDialect(parsed)
      ? named(parsed.contexts)
      : [];

  const useCasesMap =
    parsed.use_cases && typeof parsed.use_cases === "object"
      ? (parsed.use_cases as Record<string, unknown>)
      : {};

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

/**
 * Human-readable summary of Stage-6 review findings for the advisory panel —
 * e.g. "3 findings and 1 suggestion", "2 suggestions", "1 finding". A zero
 * count is omitted entirely so the errors-0 / warnings-N case never reads
 * "0 findings and N suggestions". Callers render the panel only when there is
 * at least one finding, so the result is non-empty in practice; (0, 0) yields
 * "". Deliberately NOT "issues"/"warnings": Stage-6 findings are advisory and
 * never block the manifest, and error-flavored words made every completed run
 * read as "generated with errors".
 */
export function describeFindings(
  errorCount: number,
  warningCount: number,
): string {
  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(`${errorCount} finding${errorCount === 1 ? "" : "s"}`);
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} suggestion${warningCount === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

/**
 * Distinguishes the pipeline's auto-applied advisories (deterministic fixes the
 * assembler made — e.g. an R12 adapter rename or an R03 repository-port synthesis,
 * surfaced in the Stage-6 report's `warnings`) from the reviewer's actual
 * findings. An auto-applied notice describes a change ALREADY made, so the panel
 * frames it as informational ("no action needed") rather than a warning "to
 * address".
 *
 * Anchored on the backend advisory signature — the message prefix plus, where
 * the copy carries one, its rule marker (`(R12)` / `(R03)`) — the only stable
 * signal absent a structured field on the report. Requiring the marker (when
 * defined) as well as the prefix keeps the classifier no broader than the
 * backend strings: a future reviewer finding that merely happens to open with
 * the same words can't be misfiled as a notice (and thereby dropped from the
 * actionable count). Keep in sync with the advisory copy in
 * `synthesizeMissingRepositoryPorts` / `synthesizeMissingInboundPorts` /
 * `dedupeAdapterNames` / `enforce-manifest-schema`
 * (@hexagen/agentic-interaction). A cleaner long-term fix is a dedicated
 * `notices` field on the validation report.
 */
const AUTO_APPLIED_ADVISORIES: ReadonlyArray<{
  prefix: string;
  rule?: string;
}> = [
  { prefix: "Renamed adapter ", rule: "(R12)" },
  { prefix: "Auto-added a default repository port ", rule: "(R03)" },
  // R02 inbound-port synthesis is the exact counterpart of the R03 entry above
  // (same server-side path: both merge into the report via assemblyAdvisories)
  // — it was missing here, so identical auto-applied adds were split across
  // "suggestions" (R02) and "adjustments" (R03) in the panel.
  { prefix: "Auto-added a default inbound command port ", rule: "(R02)" },
  { prefix: "Renamed context ", rule: "(R01)" },
  // Stage-5 schema-gate adjustments (enforce-manifest-schema.ts): changes
  // already made so the manifest parses on accept — notices, not findings.
  // Every entry is BOTH prefix- and marker-gated (like the rule-coded advisories
  // above): Stage-6 warnings come from unstructured model output at the NDJSON
  // boundary, so a distinctive marker substring — not the prefix alone — keeps a
  // reviewer finding that merely opens with the same words from being misfiled as
  // a notice and dropped from the actionable count (CodeRabbit/qodo #408).
  { prefix: "Coerced app entry ", rule: "the manifest schema requires" },
  {
    prefix: "Dropped an app entry without a usable name",
    rule: "the manifest schema requires",
  },
  {
    prefix: "Dropped a context mapping missing an upstream/downstream",
    rule: "endpoint",
  },
  { prefix: "Dropped ", rule: "the manifest schema requires string names" },
];

export function isAutoAppliedNotice(message: string): boolean {
  return AUTO_APPLIED_ADVISORIES.some(
    ({ prefix, rule }) =>
      message.startsWith(prefix) &&
      (rule === undefined || message.includes(rule)),
  );
}
