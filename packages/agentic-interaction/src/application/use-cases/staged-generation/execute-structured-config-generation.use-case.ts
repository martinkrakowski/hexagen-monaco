import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  DomainAnalysis,
  ClassificationResult,
  AssembledManifest,
  ValidationReport,
  NormalizedPrompt,
  ContextMappingEntry,
  AggregateRoot,
  DomainEntity,
  DomainEvent,
  DomainValueObject,
  AcceptedContext,
  InboundPortType,
  OutboundPortType,
  PortMap,
  ContextPorts,
  PortDefinition,
  AdapterBindings,
  AdapterBinding,
} from "../../../domain/value-objects/pipeline-state";
import { normalizeContextName } from "../../../domain/index";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case";
import { ExecuteManifestRepairUseCase } from "./execute-manifest-repair.use-case";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { ClassifyContextTypeUseCase } from "./classify-context-type.use-case";
import { STAGE3_ESCALATION_CONFIG } from "./retry-with-escalation";
import { sanitizePseudoYaml } from "../../../domain/utils/sanitize-pseudo-yaml";
import { countManifestEntities } from "../../../domain/manifest/count-manifest-entities";
import * as yaml from "js-yaml";

export interface StructuredConfigGenerationCallbacks {
  onProgress?: (stage: number, durationMs: number) => void;
  onError?: (stage: number, error: string, durationMs?: number) => void;
  onChunk?: (chunk: string) => void;
  /** Called at completion of each stage with full telemetry. See Phase P17. */
  onStageTelemetry?: (telemetry: StageTelemetry) => void;
}

export type StructuredConfigInput = {
  rawConfig: string;
  options: Record<string, unknown>;
};

// ── Field-level types ──────────────────────────────────────────
interface StructuredConfigField {
  name: string;
  type: string;
  key?: boolean;
  nullable?: boolean;
  private?: boolean;
  admin_only?: boolean;
  collection?: boolean;
  ref?: string;
  derived?: string;
}

interface StructuredConfigAggregate {
  name: string;
  /** true = aggregate root; false or absent = child entity */
  root?: boolean;
  parent?: string;
  fields?: StructuredConfigField[];
}

interface StructuredConfigValueObject {
  name: string;
  underlying?: string;
  immutable?: boolean;
  generated?: boolean;
  rules?: string[];
  values?: string[];
  fields?: StructuredConfigField[];
  prefix?: string;
  pattern?: string;
}

interface StructuredConfigUseCase {
  name: string;
  command?: string;
  actor?: string | string[];
}

interface StructuredConfigContextMapping {
  upstream: string;
  downstream: string;
  pattern?: string;
  mechanism?: string;
  notes?: string;
  shared?: string[];
  events?: string[];
  coupling?: string;
  // Rich "hexagonal" dialect aliases: `relationship` → pattern, `via` → mechanism.
  // Without these, two mappings between the same pair that differ only by `via`
  // (e.g. CampaignOrchestration→CreativeGeneration via two ports) collapse into
  // byte-identical `{ upstream, downstream }` duplicates in the manifest.
  relationship?: string;
  via?: string;
}

interface StructuredConfigEventBusSubscription {
  event: string;
  handler?: string;
  consumers?: string[];
}

interface StructuredConfigApp {
  name: string;
  framework?: string;
  version?: string;
  role?: string;
  deployment?: string;
  responsibilities?: string[];
  ui?: { library?: string; styling?: string };
  auth?: string;
  schedule?: string;
}

export interface StructuredConfigContext {
  name: string;
  short?: string;
  responsibility?: string;
  description?: string;
  app?: string;
  aggregates?: StructuredConfigAggregate[];
  value_objects?: StructuredConfigValueObject[];
  events_published?: string[];
  events_consumed?: Array<{
    event: string;
    notify?: string;
    channels?: string[];
  }>;
  use_cases?: never;
  status_transitions?: Record<
    string,
    Array<{
      from: string;
      to: string;
      allowed: boolean;
      guard?: string;
      trigger?: string;
      terminal?: boolean;
    }>
  >;
  type?: string;
  /** Pre-defined hexagonal layers — present when importing a manifest-format spec. */
  layers?: {
    domain?: Record<string, unknown>;
    application?: {
      ports?: {
        in?: string[];
        out?: string[];
      };
    };
    infrastructure?: {
      adapters?: string[];
    };
  };

  // ── Rich "hexagonal" import dialect ─────────────────────────────────────────
  // An alternate authoring shape (domain models nested under `domain_models`,
  // per-context `primary_use_cases`, object-form `domain_events`, and
  // driving/driven `ports`). `normalizeDialect` maps these onto the canonical
  // fields above, so the rest of the pipeline reads only the canonical shape.
  domain_models?: {
    // Explicit aggregate roots. When present, `entities` are treated as child
    // entities (root:false); when absent, each entity is treated as a root (the
    // original entities-only dialect). `attributes` may be a `{ name: type }` map
    // or a list of `{ name, type }` objects.
    aggregates?: Array<{ name: string; attributes?: unknown }>;
    entities?: Array<{ name: string; attributes?: unknown }>;
    value_objects?: Array<{
      name: string;
      type?: string;
      values?: string[];
      attributes?: unknown;
      description?: string;
    }>;
  };
  primary_use_cases?: Array<{ name: string; implements?: string }>;
  domain_events?: Array<{ name: string; payload?: Record<string, unknown> }>;
  ports?: {
    primary?: Array<{ name: string }>;
    driven?: Array<{ name: string }>;
    secondary_references?: string[];
  };
}

export interface StructuredConfig {
  /** Top-level project identifier. Maps to NormalizedPrompt.projectName. */
  project?: string;
  version?: string;
  organization?: string;
  apps?: StructuredConfigApp[];
  bounded_contexts: StructuredConfigContext[];
  /**
   * Use cases keyed by context name.
   * e.g. { "InvoicingBilling": [{ name: "CreateInvoice", actor: "admin" }] }
   */
  use_cases?: Record<string, StructuredConfigUseCase[]>;
  context_mappings?: StructuredConfigContextMapping[];
  event_bus?: {
    envelope?: Record<string, string>;
    subscriptions?: StructuredConfigEventBusSubscription[];
  };
}

/**
 * Merge a list of YAML documents into a single object.
 * Returns null if any document is not a plain object or if two documents
 * declare the same top-level key with conflicting values. This is the
 * "no surprises" merge — visual `---` separators between disjoint sections
 * (a common authoring style) work; ambiguous overrides do not.
 */
function tryMergeMultiDocYaml(
  rawConfig: string,
): Record<string, unknown> | null {
  let docs: unknown[];
  try {
    docs = yaml.loadAll(rawConfig);
  } catch {
    return null;
  }
  const objectDocs = docs.filter(
    (d): d is Record<string, unknown> =>
      d !== null && typeof d === "object" && !Array.isArray(d),
  );
  if (objectDocs.length === 0) return null;

  const merged: Record<string, unknown> = {};
  for (const doc of objectDocs) {
    for (const [key, value] of Object.entries(doc)) {
      if (
        key in merged &&
        JSON.stringify(merged[key]) !== JSON.stringify(value)
      ) {
        // Conflict — caller must resolve. Don't silently override.
        return null;
      }
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Parse a raw config string as YAML or JSON, with a best-effort recovery pass.
 * Tries a strict parse first; if that fails, retries once on a
 * `sanitizePseudoYaml`-cleaned copy (TypeScript-in-YAML specs). If recovery also
 * fails — or changes nothing — the original strict error is surfaced.
 */
export function parseStructuredConfig(rawConfig: string): StructuredConfig {
  try {
    return parseStructuredConfigStrict(rawConfig);
  } catch (strictError) {
    const sanitized = sanitizePseudoYaml(rawConfig);
    if (sanitized !== rawConfig) {
      try {
        return parseStructuredConfigStrict(sanitized);
      } catch {
        // Recovery didn't help — fall through and surface the original error.
      }
    }
    throw strictError;
  }
}

/**
 * Parse a raw config string as YAML or JSON.
 * Attempts JSON first (fastest path for .json files).
 * Falls back to single-document YAML, then to multi-document YAML
 * (visual `---` separators between disjoint top-level sections).
 * Throws a descriptive error if no parse succeeds.
 */
function parseStructuredConfigStrict(rawConfig: string): StructuredConfig {
  const trimmed = rawConfig.trimStart();

  // JSON fast path
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(rawConfig) as StructuredConfig;
      validateStructuredConfigShape(parsed);
      return normalizeDialect(parsed);
    } catch (e) {
      if (e instanceof StructuredConfigShapeError) throw e;
      // JSON parse failed — fall through to YAML
    }
  }

  // Single-document YAML path (covers .yaml, .yml, and malformed JSON)
  let singleDocError: unknown = null;
  try {
    const parsed = yaml.load(rawConfig) as StructuredConfig;
    validateStructuredConfigShape(parsed);
    return normalizeDialect(parsed);
  } catch (e) {
    if (e instanceof StructuredConfigShapeError) {
      // Single-doc parse succeeded but shape was wrong — could still be
      // multi-doc YAML where the first doc lacks bounded_contexts. Try merge.
      singleDocError = e;
    } else if (
      e instanceof Error &&
      e.message.includes("expected a single document")
    ) {
      // js-yaml refuses multi-doc input via load(); fall through to loadAll.
      singleDocError = e;
    } else {
      throw new Error(
        `Failed to parse structured config as YAML or JSON. ` +
          `Ensure the file is valid YAML or JSON with a "bounded_contexts" array. ` +
          `Parser error: ${String(e)}`,
      );
    }
  }

  // Multi-document YAML path. Handles authoring styles that use `---` as
  // a visual separator between top-level sections (apps, bounded_contexts,
  // use_cases, etc.).
  const merged = tryMergeMultiDocYaml(rawConfig);
  if (merged) {
    validateStructuredConfigShape(merged);
    return normalizeDialect(merged as StructuredConfig);
  }

  // Multi-doc fallback didn't apply — surface the single-doc error.
  if (singleDocError instanceof StructuredConfigShapeError) {
    throw singleDocError;
  }
  throw new Error(
    `Failed to parse structured config as YAML or JSON. ` +
      `Ensure the file is valid YAML or JSON with a "bounded_contexts" array. ` +
      `Parser error: ${String(singleDocError)}`,
  );
}

/** A non-empty array. An explicit `[]` counts as "absent" so a canonical empty
 * placeholder doesn't block dialect mapping (#256 review). */
function hasItems(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Whether a canonical `use_cases` map entry carries real content. Mirrors what
 * `buildDomainAnalysisFromConfig` accepts (`Array.isArray(ucs) ? ucs : [ucs]`):
 * a non-empty array OR a single use-case object. An explicit `[]` (or a
 * null/primitive) is treated as "absent" so it neither blocks nor overwrites
 * dialect-derived use cases — but an object-form entry like
 * `use_cases: { Orders: { name: "Charge" } }` still wins, as it did before the
 * empty-array fix (#256 review).
 */
function hasUseCaseContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "object" && v !== null;
}

/**
 * Keep only dialect entries that are objects with a non-empty string `name`.
 * Drops primitives / nameless objects so normalization never yields
 * `name: undefined` — which would derive broken downstream names like
 * `undefinedRepositoryPort` (#256 review).
 */
function withName<T>(arr: T[] | undefined): Array<T & { name: string }> {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is T & { name: string } => {
    if (typeof x !== "object" || x === null) return false;
    const name = (x as { name?: unknown }).name;
    return typeof name === "string" && name.trim().length > 0;
  });
}

/**
 * Map a dialect domain object's `attributes` to canonical fields. Accepts both
 * authoring shapes: a `{ name: type }` map and a list of `{ name, type }` objects.
 * The `id` attribute is flagged as the identity key.
 */
function dialectAttributesToFields(
  attrs: unknown,
): StructuredConfigField[] | undefined {
  let fields: StructuredConfigField[] = [];
  if (Array.isArray(attrs)) {
    fields = attrs
      .filter(
        (a): a is { name: string; type?: unknown } =>
          typeof a === "object" &&
          a !== null &&
          typeof (a as { name?: unknown }).name === "string",
      )
      .map((a) => ({
        name: a.name,
        type: a.type != null ? String(a.type) : "unknown",
        key: a.name === "id",
      }));
  } else if (attrs && typeof attrs === "object") {
    fields = Object.entries(attrs as Record<string, unknown>).map(
      ([name, type]) => ({ name, type: String(type), key: name === "id" }),
    );
  }
  return fields.length > 0 ? fields : undefined;
}

function dialectToAggregate(
  obj: { name: string; attributes?: unknown },
  root: boolean,
): StructuredConfigAggregate {
  return {
    name: obj.name,
    root,
    fields: dialectAttributesToFields(obj.attributes),
  };
}

/**
 * Map the rich "hexagonal" import dialect onto the canonical StructuredConfig
 * fields the pipeline actually reads — `aggregates`, `value_objects`,
 * `events_published`, `layers.application.ports`, and the top-level `use_cases`
 * map. Only fills a canonical field when it is empty/absent, so a spec already in
 * canonical form is untouched. Without this, a spec authored with `domain_models`
 * / `primary_use_cases` / `domain_events` / `ports.{primary,driven}` silently
 * loses all of its domain content (buildDomainAnalysisFromConfig reads none of
 * those keys), which surfaced as "0 use cases" in the import review.
 */
export function normalizeDialect(config: StructuredConfig): StructuredConfig {
  if (!Array.isArray(config.bounded_contexts)) return config;

  // Dialect: `project` may be an object ({ name, description, version, ... }), but
  // the pipeline expects the project NAME as a string. Coerce to `.name` so a
  // downstream `${config.project}` / projectName never becomes "[object Object]"
  // — which otherwise kebab-cases into a garbage `system`/`scope` in the manifest.
  const projectValue: unknown = config.project;
  if (projectValue && typeof projectValue === "object") {
    const name = (projectValue as { name?: unknown }).name;
    config.project =
      typeof name === "string" && name.trim().length > 0 ? name : undefined;
  }

  const useCasesFromDialect: Record<string, StructuredConfigUseCase[]> = {};
  // Canonical top-level `use_cases` win over the dialect even when keyed by a
  // context alias (`name` vs `short`) — `lookupUseCases` resolves both — so compare
  // on the normalized form, not exact keys, before taking dialect use cases. Only
  // an entry with real content counts (`hasUseCaseContent`: non-empty array or a
  // single object): an empty `use_cases: { Orders: [] }` placeholder must neither
  // block (here) nor — at merge time — clobber the dialect's primary_use_cases,
  // while an object-form `{ Orders: { name: "Charge" } }` still wins (#256 review).
  const canonicalUseCases = Object.fromEntries(
    Object.entries(config.use_cases ?? {}).filter(([, ucs]) =>
      hasUseCaseContent(ucs),
    ),
  );
  const canonicalUseCaseKeys = new Set(
    Object.keys(canonicalUseCases).map((k) => normalizeContextName(k)),
  );

  for (const ctx of config.bounded_contexts) {
    const dm = ctx.domain_models;

    // domain_models.{aggregates,entities} → ctx.aggregates. Declared `aggregates`
    // are roots; `entities` are child entities (root:false) when an explicit
    // `aggregates` list is present, otherwise the legacy entities-only shape
    // treats each entity as a root. An explicit empty `aggregates: []` is treated
    // as absent; nameless entries are dropped.
    if (!hasItems(ctx.aggregates)) {
      const dialectAggregates = withName(dm?.aggregates);
      const dialectEntities = withName(dm?.entities);
      const entitiesAreRoots = dialectAggregates.length === 0;
      const mapped: StructuredConfigAggregate[] = [
        ...dialectAggregates.map((a) => dialectToAggregate(a, true)),
        ...dialectEntities.map((e) => dialectToAggregate(e, entitiesAreRoots)),
      ];
      if (mapped.length > 0) {
        ctx.aggregates = mapped;
      }
    }

    // domain_models.value_objects → value_objects (dialect uses `type` for the
    // underlying kind, e.g. `type: enum`).
    if (!hasItems(ctx.value_objects)) {
      const vos = withName(dm?.value_objects);
      if (vos.length > 0) {
        ctx.value_objects = vos.map((vo) => ({
          name: vo.name,
          underlying: vo.type,
          values: vo.values,
        }));
      }
    }

    // domain_events (objects) → events_published (names).
    if (!hasItems(ctx.events_published) && Array.isArray(ctx.domain_events)) {
      const names = ctx.domain_events
        .map((e) => (e as { name?: unknown })?.name)
        .filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        );
      if (names.length > 0) ctx.events_published = names;
    }

    // ports.{primary → in; driven + secondary_references → out} →
    // layers.application.ports, so the pre-defined-port path honours the contracts
    // the author declared. Empty declared ports count as absent.
    const declaredPorts = ctx.layers?.application?.ports;
    const declaredPortCount =
      (declaredPorts?.in?.length ?? 0) + (declaredPorts?.out?.length ?? 0);
    if (ctx.ports && declaredPortCount === 0) {
      // Dedupe: a name can appear in both `driven` and `secondary_references`.
      const inPorts = [
        ...new Set(withName(ctx.ports.primary).map((p) => p.name)),
      ];
      const outPorts = [
        ...new Set([
          ...withName(ctx.ports.driven).map((p) => p.name),
          ...(Array.isArray(ctx.ports.secondary_references)
            ? ctx.ports.secondary_references
            : []
          ).filter(
            (n): n is string => typeof n === "string" && n.trim().length > 0,
          ),
        ]),
      ];
      if (inPorts.length > 0 || outPorts.length > 0) {
        ctx.layers = {
          ...ctx.layers,
          application: {
            ...ctx.layers?.application,
            ports: { in: inPorts, out: outPorts },
          },
        };
      }
    }

    // primary_use_cases → top-level use_cases map (per-context `use_cases` is
    // forbidden in the canonical shape — `use_cases?: never`). Nameless use cases
    // are dropped; skip when the context name itself isn't usable as a key.
    const ucs = withName(ctx.primary_use_cases);
    if (ucs.length > 0 && ctx.name) {
      // Skip when canonical use_cases already cover this context under any of its
      // aliases — canonical wins, and we must not leave a duplicate dialect entry
      // keyed by a different alias that downstream analysis would also pick up.
      const coveredByCanonical = [ctx.name, ctx.short]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .some((v) => canonicalUseCaseKeys.has(normalizeContextName(v)));
      if (!coveredByCanonical) {
        useCasesFromDialect[ctx.name] = ucs.map((uc) => ({ name: uc.name }));
      }
    }
  }

  if (Object.keys(useCasesFromDialect).length > 0) {
    // A non-empty canonical `use_cases` entry wins over the dialect; empty
    // placeholders were dropped above, so they neither block nor overwrite it.
    config.use_cases = { ...useCasesFromDialect, ...canonicalUseCases };
  }

  return config;
}

export class StructuredConfigShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredConfigShapeError";
  }
}

function validateStructuredConfigShape(
  parsed: unknown,
): asserts parsed is StructuredConfig {
  if (!parsed || typeof parsed !== "object") {
    throw new StructuredConfigShapeError(
      "Config must be an object at the root level.",
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (
    !Array.isArray(obj.bounded_contexts) ||
    (obj.bounded_contexts as unknown[]).length === 0
  ) {
    throw new StructuredConfigShapeError(
      `Config must have a non-empty "bounded_contexts" array. ` +
        `Found: ${JSON.stringify(obj.bounded_contexts ?? "missing")}`,
    );
  }
}

export function buildNormalizedPromptFromConfig(
  config: StructuredConfig,
): NormalizedPrompt {
  // Gather technology hints from app responsibilities and deployment targets
  const techHints = (config.apps ?? []).flatMap(
    (app) => app.responsibilities ?? [],
  );
  const deploymentTargets = (config.apps ?? [])
    .filter((app) => Boolean(app.deployment))
    .map((app) => app.deployment as string);
  const frameworks = (config.apps ?? [])
    .filter((app) => Boolean(app.framework))
    .map((app) => `${app.framework}${app.version ? ` ${app.version}` : ""}`);
  const authSystems = (config.apps ?? [])
    .filter((app) => Boolean(app.auth))
    .map((app) => app.auth as string);

  const platformTech = [...new Set([...frameworks, ...authSystems])].filter(
    Boolean,
  );

  const runtimeConcerns = [
    ...new Set([...techHints, ...deploymentTargets]),
  ].filter(Boolean);

  // Build intent from context responsibilities
  const intentParts = config.bounded_contexts
    .slice(0, 5)
    .map((ctx) => ctx.responsibility ?? ctx.name);
  const intent = config.project
    ? `${config.project}: ${intentParts.join("; ")}`
    : intentParts.join("; ");

  return {
    intent,
    projectName: config.project,
    explicitTechnologies: platformTech,
    runtimeConcerns,
    explicitPatterns: [],
    ambiguities: [],
    isStructuredConfig: true,
  };
}

export function buildDomainAnalysisFromConfig(
  config: StructuredConfig,
): DomainAnalysis {
  const aggregateRoots: AggregateRoot[] = [];
  const entities: DomainEntity[] = [];
  const valueObjects: DomainValueObject[] = [];
  const domainEvents: DomainEvent[] = [];
  const useCases: DomainAnalysis["useCases"] = [];

  for (const ctx of config.bounded_contexts) {
    const subdomain = ctx.name;

    // Aggregates
    for (const agg of ctx.aggregates ?? []) {
      if (agg.root !== false) {
        // root: true or root: undefined → treat as aggregate root
        aggregateRoots.push({
          name: agg.name,
          subdomain,
          identityFields: (agg.fields ?? [])
            .filter((f) => f.key === true)
            .map((f) => f.name),
        });
      } else {
        // root: false → child entity
        entities.push({
          name: agg.name,
          subdomain,
          parentAggregate: agg.parent ?? subdomain,
        });
      }
    }

    // Value objects
    for (const vo of ctx.value_objects ?? []) {
      const rules: string[] = [];
      if (vo.immutable) rules.push("immutable");
      if (vo.generated) rules.push("system-generated");
      if (vo.underlying === "enum" && vo.values) {
        rules.push(`values: [${vo.values.join(", ")}]`);
      }
      if (vo.rules) rules.push(...vo.rules);
      valueObjects.push({
        name: vo.name,
        subdomain,
        rules: rules.join("; ") || undefined,
      });
    }

    // Domain events published
    for (const event of ctx.events_published ?? []) {
      domainEvents.push({
        name: event,
        emitter: subdomain,
        trigger: undefined,
      });
    }
  }

  // Use cases from the top-level use_cases map
  const useCasesMap = config.use_cases ?? {};
  for (const [contextName, ucs] of Object.entries(useCasesMap)) {
    // Handle both single use case object and array of use cases
    const ucArray = Array.isArray(ucs) ? ucs : [ucs];
    for (const uc of ucArray) {
      const actor = Array.isArray(uc.actor)
        ? uc.actor.join(", ")
        : (uc.actor ?? "system");
      useCases.push({
        name: uc.name,
        subdomain: contextName,
        actor,
        commandName: uc.command,
      });
    }
  }

  return {
    // Legacy fields for backward compat
    verbs: useCases.map((uc) => uc.name),
    nouns: config.bounded_contexts.map((ctx) => ctx.name),
    subdomains: config.bounded_contexts.map((ctx) => ctx.name),
    // New DDD fields
    aggregateRoots,
    entities,
    valueObjects,
    domainEvents,
    useCases,
  };
}

/**
 * Infer context type from the config.
 * Uses explicit type field if present, then name/responsibility heuristics.
 */
const SUPPORTING_KEYWORDS = [
  "notification",
  "delivery",
  "document",
  "vault",
  "storage",
  "audit",
  "logging",
  "reporting",
  "analytics",
  "monitoring",
];

// Listed as "generic" DDD categories but mapped to `supporting` because
// identity/auth/payment built in-house is a supporting capability, not
// truly generic (off-the-shelf) for this codebase.
const GENERIC_TO_SUPPORTING_KEYWORDS = [
  "identity",
  "auth",
  "authentication",
  "authorization",
  "iam",
  "payment",
  "billing-gateway",
  "email",
];

const SHARED_KERNEL_KEYWORDS = [
  "shared kernel",
  "shared-kernel",
  "shared_kernel",
  "cross-cutting",
];

export function inferContextTypeWithConfidence(ctx: StructuredConfigContext): {
  type: AcceptedContext["type"];
  confidence: number;
} {
  if ("type" in ctx && ctx.type) {
    const declared = String(ctx.type).toLowerCase();
    if (declared === "core") return { type: "core", confidence: 1.0 };
    if (declared === "supporting")
      return { type: "supporting", confidence: 1.0 };
    if (declared === "generic") return { type: "generic", confidence: 1.0 };
    if (declared === "shared-kernel" || declared === "shared_kernel")
      return { type: "shared-kernel", confidence: 1.0 };
  }

  const resp = (ctx.responsibility ?? ctx.name).toLowerCase();
  const name = ctx.name.toLowerCase();
  const matches = (kws: string[]) =>
    kws.some((kw) => name.includes(kw) || resp.includes(kw));

  if (matches(SHARED_KERNEL_KEYWORDS)) {
    return { type: "shared-kernel", confidence: 0.9 };
  }
  if (matches(GENERIC_TO_SUPPORTING_KEYWORDS)) {
    return { type: "supporting", confidence: 0.7 };
  }
  if (matches(SUPPORTING_KEYWORDS)) {
    return { type: "supporting", confidence: 0.8 };
  }
  return { type: "core", confidence: 0.4 };
}

export function inferContextType(
  ctx: StructuredConfigContext,
): AcceptedContext["type"] {
  return inferContextTypeWithConfidence(ctx).type;
}

export function buildClassificationFromConfig(
  config: StructuredConfig,
  domainAnalysis: DomainAnalysis,
): ClassificationResult {
  const accepted: AcceptedContext[] = config.bounded_contexts.map((ctx) => {
    const contextName = ctx.name;

    // Aggregate roots belonging to this context
    const normalCtxName = normalizeContextName(contextName);
    const ctxAggregateRoots = (domainAnalysis.aggregateRoots ?? [])
      .filter((ar) => normalizeContextName(ar.subdomain) === normalCtxName)
      .map((ar) => ar.name);

    // Use case names belonging to this context
    const ctxUseCaseNames = (domainAnalysis.useCases ?? [])
      .filter((uc) => normalizeContextName(uc.subdomain) === normalCtxName)
      .map((uc) => uc.name);

    // Events published by this context
    const ctxEventsPublished = ctx.events_published ?? [];

    // App-level adapter hints for this context
    const ctxApp = config.apps?.find((a) => a.name === ctx.app);
    const adapterHints = ctxApp?.responsibilities
      ? `App responsibilities: ${ctxApp.responsibilities.join(", ")}`
      : undefined;

    const { type, confidence } = inferContextTypeWithConfidence(ctx);

    return {
      name: contextName,
      type,
      responsibility: ctx.responsibility ?? ctx.description ?? ctx.name,
      reasoning:
        ctx.responsibility ?? ctx.description ?? `Context: ${ctx.name}`,
      aggregateRoots: ctxAggregateRoots,
      useCaseNames: ctxUseCaseNames,
      eventsPublished: ctxEventsPublished,
      promotedFromUncertain: false,
      needsTypeReview: confidence < 0.6,
      // Non-standard underscore-prefixed field carried through for Stage 3/4 prompt enrichment
      ...(adapterHints ? { _adapterHints: adapterHints } : {}),
    } as AcceptedContext;
  });

  return { accepted, rejected: [], uncertain: [] };
}

export function buildContextMappingsFromConfig(
  config: StructuredConfig,
): ContextMappingEntry[] {
  return (config.context_mappings ?? []).map((cm) => ({
    upstream: cm.upstream,
    downstream: cm.downstream,
    // Accept the dialect aliases so relationship/port detail survives (and keeps
    // same-pair mappings distinct instead of collapsing to duplicates).
    pattern: cm.pattern ?? cm.relationship,
    mechanism: cm.mechanism ?? cm.via,
    notes: cm.notes,
    events: cm.events,
  }));
}

// ── Pre-defined port/adapter helpers (manifest-format import path) ──────────

function ctxHasPreDefinedPorts(ctx: StructuredConfigContext): boolean {
  const ports = ctx.layers?.application?.ports;
  return !!(
    (ports?.in && ports.in.length > 0) ||
    (ports?.out && ports.out.length > 0)
  );
}

function ctxHasPreDefinedAdapters(ctx: StructuredConfigContext): boolean {
  return !!ctx.layers?.infrastructure?.adapters?.length;
}

function lookupUseCases(
  config: StructuredConfig,
  contextName: string,
): StructuredConfigUseCase[] {
  if (!config.use_cases) return [];
  if (config.use_cases[contextName]) return config.use_cases[contextName];

  // Resolve all name aliases for this context (name + short field)
  const normalTarget = normalizeContextName(contextName);
  const ctxEntry = config.bounded_contexts.find(
    (c) =>
      normalizeContextName(c.name) === normalTarget ||
      (c.short ? normalizeContextName(c.short) === normalTarget : false),
  );

  const nameCandidates = new Set<string>([contextName]);
  if (ctxEntry) {
    nameCandidates.add(ctxEntry.name);
    if (ctxEntry.short) nameCandidates.add(ctxEntry.short);
  }
  const normalCandidates = new Set(
    [...nameCandidates].map(normalizeContextName),
  );

  for (const [key, value] of Object.entries(config.use_cases)) {
    if (
      nameCandidates.has(key) ||
      normalCandidates.has(normalizeContextName(key))
    ) {
      return value;
    }
  }
  return [];
}

// Exported for direct unit testing: the Stage-7 manifest-repair re-validation
// (B1a in docs/planning/stage7-repair-rca-and-remediation.md) rebuilds the port
// map from a name-only manifest, so these name→type inferences become
// load-bearing — an R03 "add a repository port" fix works only if a `…Repository`
// name classifies as `repository` here.
export function inferInboundPortType(name: string): InboundPortType {
  const l = name.toLowerCase();
  if (l.includes("event") || l.endsWith("eventport")) return "event";
  if (
    l.includes("query") ||
    l.startsWith("get") ||
    l.startsWith("find") ||
    l.startsWith("list")
  )
    return "query";
  return "command";
}

export function inferOutboundPortType(name: string): OutboundPortType {
  const l = name.toLowerCase();
  if (l.includes("reposit") || l.includes("repo")) return "repository";
  if (l.includes("publish") || l.includes("publisher")) return "publisher";
  if (l.includes("notif")) return "notifier";
  return "external-client";
}

/**
 * Deterministically derive outbound ports for a context from its source
 * config. Used when Stage 3 (LLM port mapping) fails for a context and the
 * fallback path takes over — without this, the context would be emitted
 * with no outbound ports at all (the empty array gets stripped by the YAML
 * serializer, leaving the architecture incomplete).
 *
 * Derivation rules:
 *   - Each aggregate root            → `{Root}RepositoryPort`
 *   - events_published (non-empty)   → `{FirstRootOrCtx}EventPublisherPort`
 *   - Channel-style enum value object (name contains "Channel", underlying
 *     is enum) → one `{Channel}NotifierPort` per enum value
 */
export function deriveOutboundPortsFromConfig(
  config: StructuredConfig,
  contextName: string,
): PortDefinition[] {
  const ctx = config.bounded_contexts.find((c) => c.name === contextName);
  if (!ctx) return [];

  const ports: PortDefinition[] = [];

  // 1. Repository ports — one per aggregate root.
  const roots = (ctx.aggregates ?? []).filter((a) => a.root !== false);
  for (const root of roots) {
    ports.push({
      name: `${root.name}RepositoryPort`,
      type: "repository",
      description: `Persistence for ${root.name} aggregate`,
      forAggregate: root.name,
    });
  }

  // 2. Publisher port — only if the context actually publishes events.
  const publishedEvents = ctx.events_published ?? [];
  if (publishedEvents.length > 0) {
    const prefix = roots[0]?.name ?? contextName;
    ports.push({
      name: `${prefix}EventPublisherPort`,
      type: "publisher",
      description: `Publishes domain events: ${publishedEvents.join(", ")}`,
    });
  }

  // 3. Channel notifier ports — for "delivery"-style contexts that declare
  // a DeliveryChannel-like enum value object.
  for (const vo of ctx.value_objects ?? []) {
    const isChannelLike =
      /channel/i.test(vo.name) &&
      vo.underlying === "enum" &&
      Array.isArray(vo.values) &&
      vo.values.length > 0;
    if (!isChannelLike) continue;
    for (const channel of vo.values!) {
      const pascal = channel
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      ports.push({
        name: `${pascal}NotifierPort`,
        type: "notifier",
        description: `${pascal} channel delivery`,
      });
    }
  }

  return ports;
}

function inferAdapterType(name: string): AdapterBinding["adapterType"] {
  const l = name.toLowerCase();
  if (l.includes("repo") || l.includes("reposit")) return "Repository";
  if (l.includes("controller")) return "Controller";
  if (l.includes("listener")) return "Listener";
  if (l.includes("publisher")) return "Publisher";
  if (l.includes("client")) return "HttpClient";
  if (l.includes("notif")) return "Notifier";
  return undefined;
}

function inferAdapterImplements(
  adapterName: string,
  portNames: string[],
): string {
  // Strip common technology prefixes and type suffixes to isolate the core name
  const core = adapterName
    .replace(
      /^(Postgres|Mysql|Redis|Rabbit(MQ)?|Mqtt|Express|Axios|Supabase|Stripe|Vercel|FlyIO|Email)/i,
      "",
    )
    .replace(
      /(Repo|Repository|Controller|Listener|Publisher|Client|Notifier|Integration)?Adapter$/i,
      "",
    )
    .toLowerCase();

  if (core) {
    const match = portNames.find((p) => {
      const portCore = p.replace(/Port$/i, "").toLowerCase();
      return portCore.includes(core) || core.includes(portCore);
    });
    if (match) return match;
  }
  return portNames[0] ?? "";
}

function buildPreDefinedPortMap(config: StructuredConfig): PortMap {
  return {
    contexts: config.bounded_contexts
      .filter(ctxHasPreDefinedPorts)
      .map((ctx) => ({
        contextName: ctx.name,
        in: (ctx.layers?.application?.ports?.in ?? []).map((name) => ({
          name,
          type: inferInboundPortType(name),
          description: name.replace(/Port$/, ""),
        })),
        out: (ctx.layers?.application?.ports?.out ?? []).map((name) => ({
          name,
          type: inferOutboundPortType(name),
          description: name.replace(/Port$/, ""),
        })),
      })),
  };
}

function buildPreDefinedAdapterBindings(
  config: StructuredConfig,
  portMap: PortMap,
): AdapterBindings {
  return {
    contexts: config.bounded_contexts
      .filter(ctxHasPreDefinedAdapters)
      .map((ctx) => {
        const ctxPorts = portMap.contexts.find(
          (p) => p.contextName === ctx.name,
        );
        const portNames = [
          ...(ctxPorts?.in ?? []).map((p) => p.name),
          ...(ctxPorts?.out ?? []).map((p) => p.name),
        ];
        return {
          contextName: ctx.name,
          adapters: (ctx.layers?.infrastructure?.adapters ?? []).map((name) => {
            const adapterType = inferAdapterType(name);
            return {
              name,
              type: adapterType ?? "adapter",
              implements: inferAdapterImplements(name, portNames),
              adapterType,
            };
          }),
        };
      }),
  };
}

/**
 * Summary of the optional Stage-7 verify-and-repair pass. Present on the result
 * only when a reviewer port was configured AND Stage 6 found errors (i.e. a
 * repair was attempted). `applied` is true only when the repaired manifest
 * strictly reduced the error count and replaced the original.
 */
export interface ManifestRepairSummary {
  attempted: boolean;
  applied: boolean;
  errorsBefore: number;
  errorsAfter: number;
  warningsBefore: number;
  warningsAfter: number;
}

interface EntityCounts {
  contextCount: number;
  portCount: number;
  adapterCount: number;
}

/**
 * Stage-7 integrity gate (pure). A repaired manifest is accepted only when it
 * strictly reduces the (R16/R17-excluded) error count AND does not shrink the
 * structure or drift the context set:
 *   - context count must be EXACT — no inventing or deleting bounded contexts
 *     (the primary gaming vector, e.g. deleting a banned context to shed R01);
 *   - port/adapter counts may GROW (legitimate R03/R05 additive fixes) but never
 *     shrink (blocks "delete the offending port to shed its finding").
 * Counts are taken against the ORIGINAL Stage-6 manifest, never a reconstruction.
 * See docs/planning/stage7-repair-rca-and-remediation.md §4-B3.
 */
export function evaluateRepairGate(input: {
  errorsBefore: number;
  errorsAfter: number;
  before: EntityCounts;
  after: EntityCounts;
}): {
  applied: boolean;
  reason:
    | "applied"
    | "no-error-reduction"
    | "structure-shrunk-or-context-drift";
} {
  if (input.errorsAfter >= input.errorsBefore) {
    return { applied: false, reason: "no-error-reduction" };
  }
  const contextExact = input.before.contextCount === input.after.contextCount;
  const noShrink =
    input.after.portCount >= input.before.portCount &&
    input.after.adapterCount >= input.before.adapterCount;
  if (!contextExact || !noShrink) {
    return { applied: false, reason: "structure-shrunk-or-context-drift" };
  }
  return { applied: true, reason: "applied" };
}

/**
 * R16 (description quality) and R17 (forAggregate validity) are computed from
 * Stage-3 state a name-only manifest cannot carry, so a manifest-level repair can
 * neither move them nor have them faithfully reconstructed. Drop them from the
 * gate's error comparison and the post-repair report so the gate judges only the
 * rules a manifest repair can act on (R18/R03/R05/R01). The suppression is a
 * UNIFORM reconstruction artifact (every port, not just synthesized ones), so it
 * conceals no asymmetric deficit. See the RCA doc §4-B2.
 */
export function stripReconstructionArtifacts(
  report: ValidationReport,
): ValidationReport {
  const keep = (finding: string): boolean => !/\bR1[67]\b/.test(finding);
  const errors = report.errors.filter(keep);
  return {
    errors,
    warnings: report.warnings.filter(keep),
    passed: errors.length === 0,
  };
}

export class ExecuteStructuredConfigGenerationUseCase {
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;
  // Stage 7 (optional): GPT-4o verify-and-repair, wired only when a reviewer
  // port is provided (STAGE6_REVIEWER_API_KEY). Undefined ⇒ repair disabled and
  // the post-Stage-6 path is byte-identical to before.
  private readonly stage7?: ExecuteManifestRepairUseCase;
  private readonly transactionManager: TransactionManagerPort;
  private readonly classifyUseCase?: ClassifyContextTypeUseCase;

  constructor(
    llmPort: SendStructuredRequestPort,
    transactionManager: TransactionManagerPort,
    classifyUseCase?: ClassifyContextTypeUseCase,
    escalationModel?: string,
    reviewerPort?: SendStructuredRequestPort,
  ) {
    const stage3Config = escalationModel
      ? { ...STAGE3_ESCALATION_CONFIG, escalationModel }
      : STAGE3_ESCALATION_CONFIG;
    this.stage3 = new ExecutePortMappingUseCase(llmPort, stage3Config);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
    this.stage7 = reviewerPort
      ? new ExecuteManifestRepairUseCase(reviewerPort)
      : undefined;
    this.transactionManager = transactionManager;
    this.classifyUseCase = classifyUseCase;
  }

  async execute(
    rawConfig: string,
    callbacks?: StructuredConfigGenerationCallbacks,
  ): Promise<
    | {
        success: true;
        value: AssembledManifest;
        validation: ValidationReport;
        repair?: ManifestRepairSummary;
        transactionId: string;
      }
    | { success: false; error: unknown }
  > {
    // Stage 0: Parse config + build NormalizedPrompt (synchronous, deterministic)
    const s0Start = Date.now();
    callbacks?.onProgress?.(0, 0);
    let config: StructuredConfig;
    let normalizedPrompt: NormalizedPrompt;
    try {
      config = parseStructuredConfig(rawConfig);
      normalizedPrompt = buildNormalizedPromptFromConfig(config);
    } catch (e) {
      const durationMs = Date.now() - s0Start;
      callbacks?.onError?.(
        0,
        `Failed to parse structured config: ${String(e)}`,
        durationMs,
      );
      return {
        success: false,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
    const s0Duration = Date.now() - s0Start;
    callbacks?.onProgress?.(0, s0Duration);

    // Stage 1: Build DomainAnalysis (synchronous, deterministic)
    const s1Start = Date.now();
    callbacks?.onProgress?.(1, 0);
    const domainAnalysis = buildDomainAnalysisFromConfig(config);
    const s1Duration = Date.now() - s1Start;
    callbacks?.onProgress?.(1, s1Duration);

    // Stage 2: ClassificationResult (synchronous)
    const s2Start = Date.now();
    callbacks?.onProgress?.(2, 0);
    const classification = buildClassificationFromConfig(
      config,
      domainAnalysis,
    );
    const contextMappings = buildContextMappingsFromConfig(config);

    // LLM-enhanced classification: review low-confidence contexts
    if (this.classifyUseCase) {
      for (const ctx of classification.accepted) {
        if (!ctx.needsTypeReview) continue;
        try {
          const sourceCtx = config.bounded_contexts.find(
            (c) => c.name === ctx.name,
          );
          const classifyResult = await this.classifyUseCase.execute(
            {
              name: ctx.name,
              responsibility: ctx.responsibility,
              aggregates: sourceCtx?.aggregates?.map((a) => a.name),
              value_objects: sourceCtx?.value_objects?.map((v) => v.name),
            },
            config.project,
          );
          if (classifyResult.success) {
            ctx.type = classifyResult.type;
            ctx.reasoning = classifyResult.reasoning;
          }
        } catch {
          // Silently keep heuristic type on classifier failure
        }
        ctx.needsTypeReview = false;
      }
    }

    callbacks?.onProgress?.(2, Date.now() - s2Start);

    // Stage 3: Port Mapping — skip LLM for contexts that already declare ports
    const s3Start = Date.now();
    callbacks?.onProgress?.(3, 0);

    const preDefinedPortNames = new Set(
      config.bounded_contexts.filter(ctxHasPreDefinedPorts).map((c) => c.name),
    );
    const contextsNeedingPorts = classification.accepted.filter(
      (ctx) => !preDefinedPortNames.has(ctx.name),
    );

    let mergedPortMap: PortMap;
    let mergedContextMappings: ContextMappingEntry[];

    // Issue 3: Pre-compute filtered source mappings (removes external-system entries).
    // Include both ctx.name and ctx.short so a mapping that references either form is kept.
    const knownContextNormalNames = new Set(
      config.bounded_contexts.flatMap((ctx) => {
        const names = [normalizeContextName(ctx.name)];
        if (ctx.short) names.push(normalizeContextName(ctx.short));
        return names;
      }),
    );
    const sourceMappings = contextMappings.filter(
      (m) =>
        knownContextNormalNames.has(normalizeContextName(m.upstream)) &&
        knownContextNormalNames.has(normalizeContextName(m.downstream)),
    );

    if (contextsNeedingPorts.length > 0) {
      callbacks?.onChunk?.("Stage 3 · Port Mapping");
      const partialClassification: ClassificationResult = {
        accepted: contextsNeedingPorts,
        rejected: [],
        uncertain: [],
      };
      const s3 = await this.stage3.execute(
        {
          stage0: normalizedPrompt,
          stage1: domainAnalysis,
          stage2: partialClassification,
        },
        callbacks?.onChunk,
        callbacks?.onStageTelemetry,
      );
      const s3Duration = Date.now() - s3Start;
      if (!s3.success) {
        callbacks?.onError?.(3, String(s3.error), s3Duration);
        return { success: false, error: s3.error };
      }

      // Issue 2: Validate every requested context produced LLM output; fall back to use_cases
      const portedContextNames = new Set(
        s3.value.portMap.contexts.map((c) => c.contextName),
      );
      const fallbackContexts: ContextPorts[] = [];
      for (const ctx of contextsNeedingPorts) {
        if (portedContextNames.has(ctx.name)) continue;
        const useCases = lookupUseCases(config, ctx.name);
        const fallbackOut = deriveOutboundPortsFromConfig(config, ctx.name);

        let fallbackMsg = "";
        if (useCases.length > 0 && fallbackOut.length > 0) {
          fallbackMsg = `falling back to use_cases (${useCases.length} in) and derived outbound ports (${fallbackOut.length} out)`;
        } else if (useCases.length > 0) {
          fallbackMsg = `falling back to use_cases (${useCases.length} in)`;
        } else if (fallbackOut.length > 0) {
          fallbackMsg = `falling back to derived outbound ports (${fallbackOut.length} out)`;
        } else {
          fallbackMsg = "leaving empty";
        }

        callbacks?.onChunk?.(
          `${ctx.name}: LLM returned no ports — ${fallbackMsg}`,
        );

        fallbackContexts.push({
          contextName: ctx.name,
          in: useCases.map((uc) => ({
            name: `${uc.name}Port`,
            type: inferInboundPortType(uc.name),
            description: uc.command ?? uc.name,
          })),
          out: fallbackOut,
        });
      }

      mergedPortMap = {
        contexts: [
          ...buildPreDefinedPortMap(config).contexts,
          ...s3.value.portMap.contexts,
          ...fallbackContexts,
        ],
      };

      // Issue 3: Merge source config mappings with LLM mappings (source takes priority)
      const llmMappings = s3.value.contextMappings ?? [];
      const seenKeys = new Set(
        sourceMappings.map((m) => `${m.upstream}:${m.downstream}`),
      );
      mergedContextMappings = [
        ...sourceMappings,
        ...llmMappings.filter(
          (m) => !seenKeys.has(`${m.upstream}:${m.downstream}`),
        ),
      ];
    } else {
      if (preDefinedPortNames.size > 0) {
        callbacks?.onChunk?.(
          "Stage 3 · Port Mapping (pre-defined — skipping AI)",
        );
      }
      mergedPortMap = buildPreDefinedPortMap(config);
      mergedContextMappings = sourceMappings;
    }

    // Issue 5: Override inbound ports with deterministic use_cases derivation
    // Only for contexts that went through the LLM (not pre-defined ports)
    const contextsNeedingPortsNames = new Set(
      contextsNeedingPorts.map((c) => c.name),
    );
    for (const ctxPorts of mergedPortMap.contexts) {
      if (!contextsNeedingPortsNames.has(ctxPorts.contextName)) continue;
      const useCases = lookupUseCases(config, ctxPorts.contextName);
      if (useCases.length > 0) {
        ctxPorts.in = useCases.map((uc) => ({
          name: `${uc.name}Port`,
          type: inferInboundPortType(uc.name),
          description: uc.command ?? uc.name,
        }));
      }
    }

    callbacks?.onProgress?.(3, Date.now() - s3Start);

    // Stage 4: Adapter Assignment — skip LLM for contexts that already declare adapters
    const s4Start = Date.now();
    callbacks?.onProgress?.(4, 0);

    const preDefinedAdapterNames = new Set(
      config.bounded_contexts
        .filter(ctxHasPreDefinedAdapters)
        .map((c) => c.name),
    );
    const contextsNeedingAdapters = classification.accepted.filter(
      (ctx) => !preDefinedAdapterNames.has(ctx.name),
    );

    let mergedAdapterBindings: AdapterBindings;

    if (contextsNeedingAdapters.length > 0) {
      callbacks?.onChunk?.("Stage 4 · Adapter Assignment");
      const partialClassification: ClassificationResult = {
        accepted: contextsNeedingAdapters,
        rejected: [],
        uncertain: [],
      };
      const variables: PromptVariables = {
        userDescription: rawConfig,
        deployment: (config.apps ?? [])
          .map((a) => a.deployment)
          .filter(Boolean)
          .join(", "),
      };
      const s4 = await this.stage4.execute(
        {
          stage0: normalizedPrompt,
          stage2: partialClassification,
          stage3: mergedPortMap,
          contextMappings: mergedContextMappings,
        },
        variables,
        callbacks?.onChunk,
        callbacks?.onStageTelemetry,
      );
      const s4Duration = Date.now() - s4Start;
      if (!s4.success) {
        callbacks?.onError?.(4, String(s4.error), s4Duration);
        return { success: false, error: s4.error };
      }
      mergedAdapterBindings = {
        contexts: [
          ...buildPreDefinedAdapterBindings(config, mergedPortMap).contexts,
          ...s4.value.contexts,
        ],
      };
    } else {
      if (preDefinedAdapterNames.size > 0) {
        callbacks?.onChunk?.(
          "Stage 4 · Adapter Assignment (pre-defined — skipping AI)",
        );
      }
      mergedAdapterBindings = buildPreDefinedAdapterBindings(
        config,
        mergedPortMap,
      );
    }
    callbacks?.onProgress?.(4, Date.now() - s4Start);

    // Stage 5: Manifest Assembly (synchronous, returns AssembledManifest directly)
    const s5Start = Date.now();
    callbacks?.onProgress?.(5, 0);
    const assembledManifest = this.stage5.execute({
      stage0: normalizedPrompt,
      stage1: domainAnalysis,
      stage2: classification,
      stage3: mergedPortMap,
      stage4: mergedAdapterBindings,
      contextMappings: mergedContextMappings,
      apps: config.apps ?? [],
    });
    const s5Duration = Date.now() - s5Start;
    callbacks?.onProgress?.(5, s5Duration);

    // Stage 6: Validation Review
    const s6Start = Date.now();
    callbacks?.onProgress?.(6, 0);
    callbacks?.onChunk?.("Stage 6 · Validation Review");
    const s6 = await this.stage6.execute(
      {
        stage0: normalizedPrompt,
        stage1: domainAnalysis,
        stage2: classification,
        stage3: mergedPortMap,
        stage4: mergedAdapterBindings,
        stage5: assembledManifest,
        contextMappings: mergedContextMappings,
      },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s6Duration = Date.now() - s6Start;
    if (!s6.success) {
      callbacks?.onError?.(6, String(s6.error), s6Duration);
      return { success: false, error: s6.error };
    }
    callbacks?.onProgress?.(6, s6Duration);

    // Stage 7 — optional GPT-4o verify-and-repair. Runs only when a reviewer
    // port is wired (STAGE6_REVIEWER_API_KEY) AND Stage 6 found errors. The
    // reviewer repairs the *config*; we re-run the deterministic pipeline +
    // Stage 6 on its output and accept the repair only if it STRICTLY reduces
    // the error count — so a repair can never regress the user's manifest.
    // Every failure mode (model error, unparseable output, no improvement)
    // falls back to the original manifest + report.
    let finalManifest = assembledManifest;
    let finalReport: ValidationReport = s6.value;
    let repair: ManifestRepairSummary | undefined;

    if (this.stage7 && s6.value.errors.length > 0) {
      // R16/R17 are unrepairable by a manifest-level repair and can't be
      // reconstructed from a name-only manifest, so compare like for like.
      const baselineReport = stripReconstructionArtifacts(s6.value);
      const errorsBefore = baselineReport.errors.length;
      const warningsBefore = baselineReport.warnings.length;
      const beforeCounts = countManifestEntities(
        (assembledManifest.parsedObject as Record<string, unknown>) ?? {},
      );
      const keepOriginal = (): ManifestRepairSummary => ({
        attempted: true,
        applied: false,
        errorsBefore,
        errorsAfter: errorsBefore,
        warningsBefore,
        warningsAfter: warningsBefore,
      });

      callbacks?.onChunk?.(
        `Stage 6 found ${errorsBefore} error${errorsBefore !== 1 ? "s" : ""} — handing off to the reviewer model for Stage 7 verify-and-repair`,
      );
      // Repair operates on the assembled MANIFEST (which carries the ports), NOT
      // the raw config — for AI-generated-port specs the config has no ports, so
      // a config-level repair reconstructs to an empty manifest and is always
      // rejected. See docs/planning/stage7-repair-rca-and-remediation.md.
      const repaired = await this.stage7.execute(
        assembledManifest.yaml || "",
        baselineReport,
        callbacks?.onChunk,
        callbacks?.onStageTelemetry,
      );

      if (!repaired.success) {
        callbacks?.onChunk?.(
          "Stage 7 · Repair model call failed — keeping the original manifest",
        );
        repair = keepOriginal();
      } else {
        callbacks?.onChunk?.("Stage 7 · Re-validating the repaired manifest…");
        try {
          const repairedManifest = parseStructuredConfig(repaired.value);
          const revalidated = await this.revalidateRepairedManifest(
            repairedManifest,
            {
              stage0: normalizedPrompt,
              stage1: domainAnalysis,
              contextMappings: mergedContextMappings,
              apps: config.apps ?? [],
            },
          );
          if (!revalidated.success) {
            callbacks?.onChunk?.(
              "Stage 7 · Re-validation failed — keeping the original manifest",
            );
            repair = keepOriginal();
          } else {
            const cleanReport = stripReconstructionArtifacts(
              revalidated.report,
            );
            const errorsAfter = cleanReport.errors.length;
            const afterCounts = countManifestEntities(
              (revalidated.manifest.parsedObject as Record<string, unknown>) ??
                {},
            );
            const gate = evaluateRepairGate({
              errorsBefore,
              errorsAfter,
              before: beforeCounts,
              after: afterCounts,
            });

            repair = {
              attempted: true,
              applied: gate.applied,
              errorsBefore,
              errorsAfter,
              warningsBefore,
              warningsAfter: cleanReport.warnings.length,
            };

            if (gate.applied) {
              finalManifest = revalidated.manifest;
              finalReport = cleanReport;
              callbacks?.onChunk?.(
                `Stage 7 · Repaired ${errorsBefore - errorsAfter} of ${errorsBefore} error${errorsBefore !== 1 ? "s" : ""} — ${errorsAfter} remain`,
              );
            } else if (gate.reason === "no-error-reduction") {
              callbacks?.onChunk?.(
                `Stage 7 · Repair did not reduce errors (${errorsAfter} vs ${errorsBefore}) — keeping the original manifest`,
              );
            } else {
              callbacks?.onChunk?.(
                "Stage 7 · Repair shrank or restructured the manifest (contexts/ports/adapters) — keeping the original",
              );
            }
          }
        } catch {
          callbacks?.onChunk?.(
            "Stage 7 · Repair output was not a valid manifest — keeping the original manifest",
          );
          repair = keepOriginal();
        }
      }
    }

    // Create transaction for the (possibly repaired) manifest
    const intentId = `spec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const yaml = finalManifest.yaml || "";
    const parsed =
      (finalManifest.parsedObject as Record<string, unknown>) || {};

    // Shared A2/A4 counter — reads the nested layers.* path. The previous inline
    // version read ctx.ports/ctx.adapters at the context root, so this path's
    // transaction metadata always recorded 0 ports and 0 adapters.
    const { contextCount, portCount, adapterCount } =
      countManifestEntities(parsed);

    let transaction: Awaited<ReturnType<TransactionManagerPort["begin"]>>;
    try {
      transaction = await this.transactionManager.begin(intentId, {
        intentId,
        origin: "structured-config-generation",
        yaml,
        contextCount,
        portCount,
        adapterCount,
      });
    } catch (beginError) {
      return { success: false, error: beginError };
    }

    try {
      await this.transactionManager.transition(transaction.id, "speculative");
    } catch (transitionError) {
      await this.transactionManager.rollback(transaction.id);
      return { success: false, error: transitionError };
    }

    return {
      success: true,
      value: finalManifest,
      // Surface the Stage-6 findings (re-validated when Stage 7 repaired the
      // manifest) so the route/UI can show them as an advisory review — not a
      // failure to retry.
      validation: finalReport,
      ...(repair ? { repair } : {}),
      transactionId: transaction.id,
    };
  }

  /**
   * Re-validate a repaired MANIFEST for Stage 7. The manifest carries
   * `layers.application.ports` as string names (see draft-to-manifest.transform),
   * so buildPreDefinedPortMap reconstructs the real ports — unlike the raw
   * config, which for AI-generated-port specs has none. Classification (stage2)
   * is REBUILT from the repaired manifest so R01's banned-context check sees the
   * repaired context names; stage0 (intent / runtime concerns) and stage1
   * (aggregate roots) are unchanged by a port/name repair, so they're reused.
   * Silent (no onChunk / onStageTelemetry) so it doesn't double-emit a chip.
   */
  private async revalidateRepairedManifest(
    repairedManifest: StructuredConfig,
    base: {
      stage0: NormalizedPrompt;
      stage1: DomainAnalysis;
      contextMappings: ContextMappingEntry[];
      apps: StructuredConfigApp[];
    },
  ): Promise<
    | { success: true; manifest: AssembledManifest; report: ValidationReport }
    | { success: false; error: unknown }
  > {
    const classification = buildClassificationFromConfig(
      repairedManifest,
      base.stage1,
    );
    const portMap = buildPreDefinedPortMap(repairedManifest);
    const adapterBindings = buildPreDefinedAdapterBindings(
      repairedManifest,
      portMap,
    );
    const manifest = this.stage5.execute({
      stage0: base.stage0,
      stage1: base.stage1,
      stage2: classification,
      stage3: portMap,
      stage4: adapterBindings,
      contextMappings: base.contextMappings,
      apps: base.apps,
    });
    const revalidation = await this.stage6.execute({
      stage0: base.stage0,
      stage1: base.stage1,
      stage2: classification,
      stage3: portMap,
      stage4: adapterBindings,
      stage5: manifest,
      contextMappings: base.contextMappings,
    });
    if (!revalidation.success) {
      return { success: false, error: revalidation.error };
    }
    return { success: true, manifest, report: revalidation.value };
  }
}
