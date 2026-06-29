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
import { synthesizeMissingRepositoryPorts } from "../../../domain/manifest/synthesize-repository-ports";
import {
  dedupeAdapterNames,
  type RenamedAdapter,
} from "../../../domain/manifest/dedupe-adapter-names";
import { isBannedContextName } from "../../../domain/prompts/architecture-contract";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case";
import {
  ExecuteValidationReviewUseCase,
  type Stage6ReviewerConfig,
} from "./execute-validation-review.use-case";
import { ExecuteManifestRepairUseCase } from "./execute-manifest-repair.use-case";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { ClassifyContextTypeUseCase } from "./classify-context-type.use-case";
import { STAGE3_ESCALATION_CONFIG } from "./retry-with-escalation";
import { sanitizePseudoYaml } from "../../../domain/utils/sanitize-pseudo-yaml";
import { countManifestEntities } from "../../../domain/manifest/count-manifest-entities";
import {
  parseRepairOps,
  applyManifestOps,
  type ManifestObject,
} from "../../../domain/manifest/apply-repair-ops";
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
  /**
   * Architectural-zone dialect (e.g. `plane: shared-kernel`). Not a canonical
   * field — `normalizeDialect` maps a shared-kernel plane onto `type:
   * "shared-kernel"` (the field the validators read for the R02/R03/R09
   * exemptions). Other planes are advisory and left untouched.
   */
  plane?: string;
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

  // Architectural-plane → canonical type. The shared-kernel zone is the one
  // "plane" with a canonical context-TYPE equivalent — and it's the field the
  // R02/R03/R09 (and R17) exemptions read. Authors express it as a per-context
  // `plane: shared-kernel` and/or a top-level `planes: { shared-kernel: [...] }`
  // block; neither is canonical, so both are read defensively. Mis-typing a
  // shared kernel as a regular context floods the review with R02/R17 (a
  // port-mapped type-only context) instead of the single R09 the author wants.
  const sharedKernelNames = new Set<string>();
  const planesBlock = (config as { planes?: Record<string, unknown> }).planes;
  if (planesBlock && typeof planesBlock === "object") {
    for (const key of ["shared-kernel", "shared_kernel"]) {
      const members = (planesBlock as Record<string, unknown>)[key];
      if (Array.isArray(members)) {
        for (const m of members) {
          if (typeof m === "string" && m.trim().length > 0) {
            sharedKernelNames.add(normalizeContextName(m));
          }
        }
      }
    }
  }

  for (const ctx of config.bounded_contexts) {
    const dm = ctx.domain_models;

    // Map a shared-kernel plane onto the canonical `type` (see note above). An
    // explicit `type: shared-kernel` already works; a shared-kernel plane wins
    // over a non-shared-kernel `type` (generic/core/supporting), since the plane
    // is the explicit structural designation.
    const planeStr =
      typeof ctx.plane === "string" ? ctx.plane.toLowerCase().trim() : "";
    const ctxNameNorm =
      typeof ctx.name === "string" ? normalizeContextName(ctx.name) : "";
    if (
      (planeStr === "shared-kernel" ||
        planeStr === "shared_kernel" ||
        (ctxNameNorm !== "" && sharedKernelNames.has(ctxNameNorm))) &&
      String(ctx.type ?? "").toLowerCase() !== "shared-kernel" &&
      String(ctx.type ?? "").toLowerCase() !== "shared_kernel"
    ) {
      ctx.type = "shared-kernel";
    }

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

/**
 * Shared-kernel contexts are type-only contracts; R09 forbids them owning ports
 * or adapters. Stage 3 already skips them, but an *imported* manifest can carry
 * pre-defined ports/adapters on a shared-kernel — those must not flow through
 * the manifest-format merge, or the assembled manifest contradicts its own
 * recognition (a "type-only" context that still owns SceneTypesCommandPort + a
 * repository adapter). Tolerant of the `shared_kernel` dialect spelling.
 */
function ctxIsSharedKernel(ctx: StructuredConfigContext): boolean {
  // `ctx.type` is import/LLM-derived and only typed `string` — guard the runtime
  // shape so a malformed manifest (non-string type) can't throw on `.trim()` and
  // abort generation. (coerceContextType isn't used here: it has the same
  // unguarded `.trim()` and would miss the `shared_kernel` dialect spelling.)
  return (
    typeof ctx.type === "string" &&
    ctx.type.trim().toLowerCase().replace(/_/g, "-") === "shared-kernel"
  );
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
  // "reposit" can't false-match "report"; the bare "repo" shorthand is matched
  // only as a TRAILING token (…Repo / …RepoPort) so e.g. ReportPublisherPort
  // classifies as a publisher, not a repository (PR #344 review).
  if (l.includes("reposit") || /repo(port)?$/.test(l)) return "repository";
  if (l.includes("publish")) return "publisher";
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
  // No name match → leave UNBOUND ("") rather than misattributing to the first
  // port: a false `implements` hides the real R04/R05 on the intended port and
  // manufactures a double-coverage error on portNames[0]. An empty implements is
  // skipped by the R04/R05 adapter-count loop, so the unmatched port correctly
  // surfaces as uncovered — the safer failure mode for the deterministic gate.
  return "";
}

/** First line of an error, truncated — surfaces a previously-swallowed reason. */
function summarizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0].slice(0, 160);
}

/**
 * Coerce one port/adapter entry to its NAME. A manifest carries these as bare
 * name STRINGS, but a repair model often "helpfully" emits a typed object
 * (`{ name, type }`) because the findings talk about port types — that used to
 * throw `name.toLowerCase is not a function` deep in the rebuild and was swallowed
 * as "not a valid manifest". Salvage the name from either shape; return null for a
 * genuinely un-nameable entry so the caller can DISCARD it (and report it) instead
 * of crashing or silently keeping garbage. (Stage-7 robustness.)
 */
export function coercePortName(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object") {
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

/**
 * Coerce a ports/adapters list SLOT to an array. A manifest carries these as YAML
 * lists, but a repair model may emit a single item as a scalar (`out: FooPort`)
 * or, less recoverably, an object. Salvage a scalar as a one-element list;
 * anything else (object, number) yields [] — and is reported by
 * collectMalformedManifestEntries, never silently dropped. Without this the bare
 * `.map` / `for…of` over the slot would throw and discard the whole repair (PR #346).
 */
function toEntryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) return [value];
  return [];
}

/**
 * Port/adapter entries a repair model emitted that aren't a usable bare name —
 * collected so the orchestrator can REPORT them. A silently-dropped port the
 * model was trying to add would make an applied repair quietly incomplete, which
 * is harder to notice than an outright failure (PR #344 review follow-up).
 */
export function collectMalformedManifestEntries(
  manifest: StructuredConfig,
): Array<{ context: string; kind: string; raw: unknown }> {
  const malformed: Array<{ context: string; kind: string; raw: unknown }> = [];
  const scan = (ctx: string, kind: string, value: unknown) => {
    // A present-but-wrong-shape slot (an object/number, not a list or a scalar
    // name) can't be salvaged — report the slot itself rather than throw on
    // `for…of` over a non-iterable.
    if (
      value != null &&
      !Array.isArray(value) &&
      !(typeof value === "string" && value.trim().length > 0)
    ) {
      malformed.push({ context: ctx, kind, raw: value });
      return;
    }
    for (const entry of toEntryArray(value)) {
      if (coercePortName(entry) === null)
        malformed.push({ context: ctx, kind, raw: entry });
    }
  };
  for (const ctx of manifest.bounded_contexts) {
    scan(ctx.name, "in-port", ctx.layers?.application?.ports?.in);
    scan(ctx.name, "out-port", ctx.layers?.application?.ports?.out);
    scan(ctx.name, "adapter", ctx.layers?.infrastructure?.adapters);
  }
  return malformed;
}

export function buildPreDefinedPortMap(config: StructuredConfig): PortMap {
  // Coerce + drop un-nameable entries so a typed-object port doesn't throw the
  // whole rebuild; discards are reported separately (collectMalformedManifestEntries).
  const names = (entries: unknown): string[] =>
    toEntryArray(entries)
      .map(coercePortName)
      .filter((n): n is string => n !== null);
  return {
    contexts: config.bounded_contexts
      .filter(ctxHasPreDefinedPorts)
      // R09: a shared-kernel owns no ports, even when the imported spec declares
      // some — drop them so the output matches Stage 3's "no ports" recognition.
      .filter((ctx) => !ctxIsSharedKernel(ctx))
      .map((ctx) => ({
        contextName: ctx.name,
        in: names(ctx.layers?.application?.ports?.in).map((name) => ({
          name,
          type: inferInboundPortType(name),
          description: name.replace(/Port$/, ""),
        })),
        out: names(ctx.layers?.application?.ports?.out).map((name) => ({
          name,
          type: inferOutboundPortType(name),
          description: name.replace(/Port$/, ""),
        })),
      })),
  };
}

export function buildPreDefinedAdapterBindings(
  config: StructuredConfig,
  portMap: PortMap,
): AdapterBindings {
  return {
    contexts: config.bounded_contexts
      .filter(ctxHasPreDefinedAdapters)
      // R09: a shared-kernel owns no adapters either — drop pre-defined ones.
      .filter((ctx) => !ctxIsSharedKernel(ctx))
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
          adapters: toEntryArray(ctx.layers?.infrastructure?.adapters)
            .map(coercePortName)
            .filter((name): name is string => name !== null)
            .map((name) => {
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
  domainEntityCount: number;
  /** Sorted, normalized bounded-context names — lets the gate reject a
   * count-preserving SWAP (delete A, add C) that count equality alone misses. */
  contextNames: string[];
}

/**
 * Count domain members (aggregate roots / child entities + value objects) across
 * an assembled manifest's `layers.domain`. The gate uses this so a repair that
 * drops a context's domain model — e.g. a rename whose new context ships an EMPTY
 * `layers.domain` because the reviewer didn't carry the members over — is caught
 * even though contexts/ports/adapters are preserved (PR #344 review). Never throws.
 */
function countDomainMembers(parsed: unknown): number {
  const root = (parsed ?? {}) as { bounded_contexts?: unknown };
  const contexts = Array.isArray(root.bounded_contexts)
    ? root.bounded_contexts
    : [];
  let count = 0;
  for (const ctx of contexts) {
    if (ctx == null || typeof ctx !== "object") continue;
    const domain = (
      ctx as {
        layers?: { domain?: { entities?: unknown; value_objects?: unknown } };
      }
    ).layers?.domain;
    if (Array.isArray(domain?.entities)) count += domain.entities.length;
    if (Array.isArray(domain?.value_objects))
      count += domain.value_objects.length;
  }
  return count;
}

/**
 * Sorted, normalized bounded-context names from an assembled manifest. The gate
 * compares the before/after set so a count-preserving SWAP (delete one context,
 * add another) is rejected — `contextCount` equality alone can't see it. Never throws.
 */
function manifestContextNames(parsed: unknown): string[] {
  const root = (parsed ?? {}) as { bounded_contexts?: unknown };
  const contexts = Array.isArray(root.bounded_contexts)
    ? root.bounded_contexts
    : [];
  const names: string[] = [];
  for (const ctx of contexts) {
    if (ctx == null || typeof ctx !== "object") continue;
    const name = (ctx as { name?: unknown }).name;
    if (typeof name === "string") names.push(normalizeContextName(name));
  }
  return names.sort();
}

/**
 * Stage-7 integrity gate (pure). A repaired manifest is accepted only when it
 * strictly reduces the (R16/R17-excluded) error count AND does not shrink the
 * structure or drift the context set:
 *   - context count must be EXACT — no inventing or deleting bounded contexts;
 *   - the context-name SET must be identical UNLESS the baseline carried a
 *     renamable (R01) finding — count equality alone admits a SWAP (delete A,
 *     add C), so when no rename is warranted the names must match exactly; an
 *     R01 baseline opts into renames (the only repair that changes a name);
 *   - port/adapter counts may GROW (legitimate R03/R05 additive fixes) but never
 *     shrink (blocks "delete the offending port to shed its finding");
 *   - domain-member count must not shrink — a swap or a rename that drops the
 *     renamed context's domain keeps contexts/ports exact but loses members.
 * Counts are taken against the ORIGINAL Stage-6 manifest, never a reconstruction.
 * See docs/planning/stage7-repair-rca-and-remediation.md §4-B3.
 */
export function evaluateRepairGate(input: {
  errorsBefore: number;
  errorsAfter: number;
  before: EntityCounts;
  after: EntityCounts;
  /** The baseline had a renamable (R01) finding, so a context-name change is a
   * legitimate repair. Defaults to false ⇒ the name set must be preserved. */
  allowContextRename?: boolean;
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
  // contextNames are pre-sorted, so element-wise equality compares the sets.
  const contextSetEqual =
    input.before.contextNames.length === input.after.contextNames.length &&
    input.before.contextNames.every(
      (n, i) => n === input.after.contextNames[i],
    );
  const contextOk =
    contextExact && (input.allowContextRename === true || contextSetEqual);
  const noShrink =
    input.after.portCount >= input.before.portCount &&
    input.after.adapterCount >= input.before.adapterCount &&
    input.after.domainEntityCount >= input.before.domainEntityCount;
  if (!contextOk || !noShrink) {
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
  // Tag-anchored (findings are always `[Rxx] …`) so an R03/R18 finding whose
  // message merely mentions R16/R17 isn't dropped (PR #344 review).
  const keep = (finding: string): boolean => !/^\[R1[67]\]/.test(finding);
  const errors = report.errors.filter(keep);
  return {
    errors,
    warnings: report.warnings.filter(keep),
    passed: errors.length === 0,
  };
}

/**
 * Deterministic structural gate — checks R01–R09 against the assembled
 * stage-3/4 data. Used by the Stage-7 repair gate in place of a second LLM
 * Stage-6 call so the before/after error counts are stable across runs.
 *
 * Covers every rule a manifest-level repair op can touch:
 *   R01 banned context name · R02 no inbound port · R03 no repository port
 *   R04/R05 port lacks exactly-one adapter · R06 cross-context implements
 *   R07 dangling depends_on · R08 empty workspace · R09 shared-kernel has ports
 *
 * NOT a full validation: semantic / fidelity rules (R10–R15 including
 * event-pairing and intent reflection) require LLM context and are left to the
 * user-facing Stage-6 pass. R16/R17/R18 are handled by collectPortQualityIssues
 * inside Stage-6 and are not re-checked here (they survive stripReconstructionArtifacts).
 */
export function structuralManifestErrors(
  portMap: PortMap,
  adapterBindings: AdapterBindings,
  parsedManifest: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  // Typed view of the assembled manifest's bounded contexts (R07/R08/R09 type lookup).
  const rawContexts = Array.isArray(parsedManifest.bounded_contexts)
    ? (parsedManifest.bounded_contexts as Array<{
        name?: unknown;
        type?: unknown;
        depends_on?: unknown;
      }>)
    : [];

  // name → type lookup (normalized) for shared-kernel detection in R02/R03/R09.
  const contextTypeByNorm = new Map<string, string>();
  for (const ctx of rawContexts) {
    if (typeof ctx.name === "string") {
      contextTypeByNorm.set(
        normalizeContextName(ctx.name),
        typeof ctx.type === "string" ? ctx.type : "",
      );
    }
  }

  // All known context names (normalized) for R07 dangling-dependency check.
  const knownContextNorms = new Set(contextTypeByNorm.keys());

  // Per-context adapter counts: contextNorm → portName → # adapters implementing it.
  const portAdapterCount = new Map<string, Map<string, number>>();
  for (const ctxAdapters of adapterBindings.contexts) {
    const ctxNorm = normalizeContextName(ctxAdapters.contextName);
    if (!portAdapterCount.has(ctxNorm))
      portAdapterCount.set(ctxNorm, new Map());
    const countMap = portAdapterCount.get(ctxNorm)!;
    for (const adapter of ctxAdapters.adapters) {
      if (adapter.implements) {
        countMap.set(
          adapter.implements,
          (countMap.get(adapter.implements) ?? 0) + 1,
        );
      }
    }
  }

  // Per-context port-name sets for the R06 cross-context check. A single global
  // name→owner map mis-attributes a port name that two contexts both define
  // (last writer wins), producing a false R06 for the other context's own
  // adapter; per-context membership is collision-safe.
  const portsByContext = new Map<string, Set<string>>();
  const allPortNames = new Set<string>();
  for (const ctx of portMap.contexts) {
    const ctxNorm = normalizeContextName(ctx.contextName);
    const set = portsByContext.get(ctxNorm) ?? new Set<string>();
    for (const p of [...ctx.in, ...ctx.out]) {
      set.add(p.name);
      allPortNames.add(p.name);
    }
    portsByContext.set(ctxNorm, set);
  }

  // Per-context checks (R01–R05, R09).
  for (const ctx of portMap.contexts) {
    // A malformed/partial repaired manifest can yield contextName: undefined
    // (buildPreDefinedPortMap maps ctx.name verbatim). Skip it — isBannedContextName
    // tokenizes the name and would throw, crashing the gate instead of failing
    // safe to keepOriginal().
    if (typeof ctx.contextName !== "string") continue;
    const ctxNorm = normalizeContextName(ctx.contextName);
    const isSharedKernel = contextTypeByNorm.get(ctxNorm) === "shared-kernel";

    // R01: banned context name.
    if (isBannedContextName(ctx.contextName)) {
      errors.push(
        `[R01] Context '${ctx.contextName}' contains a banned technology token.`,
      );
    }

    if (isSharedKernel) {
      // R09: shared-kernel contexts must have no ports.
      if (ctx.in.length > 0 || ctx.out.length > 0) {
        errors.push(
          `[R09] Context '${ctx.contextName}' is a shared-kernel but has ${ctx.in.length} inbound and ${ctx.out.length} outbound ports.`,
        );
      }
      continue; // R02/R03/R04/R05 do not apply to shared-kernels.
    }

    // R02: at least one inbound port.
    if (ctx.in.length === 0) {
      errors.push(`[R02] Context '${ctx.contextName}' has no inbound ports.`);
    }

    // R03: at least one outbound repository port.
    if (!ctx.out.some((p) => p.type === "repository")) {
      errors.push(
        `[R03] Context '${ctx.contextName}' has no outbound repository port.`,
      );
    }

    // R04/R05: each port must have exactly one adapter implementing it.
    const countMap = portAdapterCount.get(ctxNorm) ?? new Map<string, number>();
    for (const port of ctx.out) {
      const n = countMap.get(port.name) ?? 0;
      if (n !== 1) {
        errors.push(
          `[R04] Outbound port '${port.name}' in '${ctx.contextName}' has ${n} adapter${n !== 1 ? "s" : ""} (expected 1).`,
        );
      }
    }
    for (const port of ctx.in) {
      const n = countMap.get(port.name) ?? 0;
      if (n !== 1) {
        errors.push(
          `[R05] Inbound port '${port.name}' in '${ctx.contextName}' has ${n} adapter${n !== 1 ? "s" : ""} (expected 1).`,
        );
      }
    }
  }

  // Portless contexts: buildPreDefinedPortMap drops contexts with no ports, so a
  // context present in the manifest but ABSENT from portMap is portless and
  // still violates R02/R03 (and R01 if its name is banned). Catch them here —
  // otherwise a repair could make a context's R02/R03 "disappear" by orphaning
  // its ports and the gate would accept a still-broken manifest.
  const portMapNorms = new Set(
    portMap.contexts.map((c) => normalizeContextName(c.contextName)),
  );
  for (const ctx of rawContexts) {
    if (typeof ctx.name !== "string") continue;
    const ctxNorm = normalizeContextName(ctx.name);
    if (portMapNorms.has(ctxNorm)) continue; // handled by the per-context loop
    if (contextTypeByNorm.get(ctxNorm) === "shared-kernel") continue; // portless shared-kernel is valid
    if (isBannedContextName(ctx.name)) {
      errors.push(
        `[R01] Context '${ctx.name}' contains a banned technology token.`,
      );
    }
    errors.push(`[R02] Context '${ctx.name}' has no inbound ports.`);
    errors.push(`[R03] Context '${ctx.name}' has no outbound repository port.`);
  }

  // R06: no adapter implements a port that belongs to a DIFFERENT context. An
  // adapter is fine when its OWN context owns the port (even if another context
  // also has a port by that name), so check own-context membership — fire only
  // when the port is absent from the adapter's context but owned elsewhere.
  for (const ctxAdapters of adapterBindings.contexts) {
    const ctxNorm = normalizeContextName(ctxAdapters.contextName);
    const ownPorts = portsByContext.get(ctxNorm) ?? new Set<string>();
    for (const adapter of ctxAdapters.adapters) {
      if (!adapter.implements) continue;
      if (
        !ownPorts.has(adapter.implements) &&
        allPortNames.has(adapter.implements)
      ) {
        errors.push(
          `[R06] Adapter '${adapter.name}' in '${ctxAdapters.contextName}' implements '${adapter.implements}' which belongs to a different context.`,
        );
      }
    }
  }

  // R07: every depends_on reference must point to an existing context name.
  for (const ctx of rawContexts) {
    const deps = Array.isArray(ctx.depends_on) ? ctx.depends_on : [];
    for (const dep of deps) {
      if (
        typeof dep === "string" &&
        !knownContextNorms.has(normalizeContextName(dep))
      ) {
        errors.push(
          `[R07] Context '${ctx.name}' depends_on '${dep}' which does not exist.`,
        );
      }
    }
  }

  // R08: workspace name (system) and description (scope) must be non-empty.
  const system =
    typeof parsedManifest.system === "string"
      ? parsedManifest.system.trim()
      : "";
  const scope =
    typeof parsedManifest.scope === "string" ? parsedManifest.scope.trim() : "";
  if (!system || !scope) {
    // Name BOTH empty fields, not just the first — when system and scope are
    // both empty the single-field message hid the second (qodo #351).
    const missing = [
      !system && "system name (workspace.name)",
      !scope && "scope (workspace.description)",
    ]
      .filter(Boolean)
      .join(" and ");
    // "are" for the compound subject when both fields are missing.
    const verb = !system && !scope ? "are" : "is";
    errors.push(`[R08] Workspace is incomplete — ${missing} ${verb} empty.`);
  }

  return errors;
}

/**
 * Re-key the reused stage-1 domain analysis to the REPAIRED context names so a
 * renamed context's members re-attach under their new name during Stage-5's
 * subdomain-match enrichment (assembly:115) instead of orphaning to an EMPTY
 * `layers.domain` (silent domain-model loss; the gate counts contexts/ports/
 * adapters, not domain members, so it can't catch it). Caught in PR #344 review.
 *
 * The re-key is keyed on each member's OLD SUBDOMAIN, never on its NAME: a flat
 * member-name → context map collapses shared value-object names (e.g. `Address`
 * legitimately owned by two contexts) onto one entry — last-write-wins — which
 * drops one context's domain and duplicates it in the other, on ANY applied
 * repair (not only renames). Keying on the old subdomain keeps same-named members
 * in different contexts independent. An additive (no-rename) repair is a strict
 * no-op. (PR #344 collision blocker.)
 */
export function rekeyDomainAnalysisToManifest(
  stage1: DomainAnalysis,
  manifest: StructuredConfig,
): DomainAnalysis {
  // OLD domain members grouped by their current stage-1 subdomain.
  const oldByNorm = new Map<string, { name: string; members: Set<string> }>();
  for (const item of [
    ...(stage1.aggregateRoots ?? []),
    ...(stage1.entities ?? []),
    ...(stage1.valueObjects ?? []),
  ]) {
    if (!item.subdomain) continue;
    const key = normalizeContextName(item.subdomain);
    let entry = oldByNorm.get(key);
    if (!entry)
      oldByNorm.set(
        key,
        (entry = { name: item.subdomain, members: new Set() }),
      );
    entry.members.add(item.name);
  }

  // NEW context names + their (name-only) domain members from the repaired manifest.
  const newByNorm = new Map<string, { name: string; members: Set<string> }>();
  for (const ctx of manifest.bounded_contexts) {
    const domain = ctx.layers?.domain as
      | { entities?: unknown; value_objects?: unknown }
      | undefined;
    const members = new Set<string>();
    for (const n of [
      ...(Array.isArray(domain?.entities) ? domain.entities : []),
      ...(Array.isArray(domain?.value_objects) ? domain.value_objects : []),
    ]) {
      if (typeof n === "string") members.add(n);
    }
    newByNorm.set(normalizeContextName(ctx.name), { name: ctx.name, members });
  }

  // Only old contexts whose name no longer exists in the manifest were renamed
  // away; an unchanged name keeps its subdomain untouched. No disappearance ⇒
  // nothing to re-key ⇒ no-op (the additive-repair fast path).
  const renamedOldNorms = [...oldByNorm.keys()].filter(
    (k) => !newByNorm.has(k),
  );
  if (renamedOldNorms.length === 0) return stage1;

  // Candidate new names = manifest contexts that aren't an unchanged old name.
  const candidateNewNorms = [...newByNorm.keys()].filter(
    (k) => !oldByNorm.has(k),
  );

  // Greedily pair each renamed-away old context to the new context sharing the
  // most domain members (a rename preserves the member set). Deterministic:
  // process old names sorted, break overlap ties by the smaller new name.
  const oldNormToNewName = new Map<string, string>();
  const taken = new Set<string>();
  for (const oldNorm of [...renamedOldNorms].sort()) {
    const oldMembers = oldByNorm.get(oldNorm)!.members;
    let best: { norm: string; overlap: number } | undefined;
    for (const newNorm of candidateNewNorms) {
      if (taken.has(newNorm)) continue;
      let overlap = 0;
      for (const m of newByNorm.get(newNorm)!.members) {
        if (oldMembers.has(m)) overlap++;
      }
      if (
        overlap > 0 &&
        (best === undefined ||
          overlap > best.overlap ||
          (overlap === best.overlap && newNorm < best.norm))
      ) {
        best = { norm: newNorm, overlap };
      }
    }
    if (best) {
      oldNormToNewName.set(oldNorm, newByNorm.get(best.norm)!.name);
      taken.add(best.norm);
    }
  }
  if (oldNormToNewName.size === 0) return stage1;

  const rekey = <T extends { name: string; subdomain?: string }>(
    item: T,
  ): T => {
    if (!item.subdomain) return item;
    const newName = oldNormToNewName.get(normalizeContextName(item.subdomain));
    return newName !== undefined ? { ...item, subdomain: newName } : item;
  };
  return {
    ...stage1,
    ...(stage1.aggregateRoots
      ? { aggregateRoots: stage1.aggregateRoots.map(rekey) }
      : {}),
    ...(stage1.entities ? { entities: stage1.entities.map(rekey) } : {}),
    ...(stage1.valueObjects
      ? { valueObjects: stage1.valueObjects.map(rekey) }
      : {}),
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
    stage6Reviewer?: Stage6ReviewerConfig,
  ) {
    const stage3Config = escalationModel
      ? { ...STAGE3_ESCALATION_CONFIG, escalationModel }
      : STAGE3_ESCALATION_CONFIG;
    this.stage3 = new ExecutePortMappingUseCase(llmPort, stage3Config);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = stage6Reviewer
      ? new ExecuteValidationReviewUseCase(
          stage6Reviewer.port,
          stage6Reviewer.maxTokens,
        )
      : new ExecuteValidationReviewUseCase(llmPort);
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

    // R03 invariant satisfaction at the source: a non-shared-kernel context that
    // Stage 3 left with no outbound repository port gets a default
    // <Aggregate>RepositoryPort + matching adapter (explicit type/implements).
    // Done on the merged structures Stage 6 + the Stage-7 gate actually read, so
    // R03 never reaches the reviewer and the gate never burns a self-defeating
    // add-out-port repair. Stage 5 consumes the same structures, so the port +
    // adapter also land in the rendered manifest.
    const repoSynthesis = synthesizeMissingRepositoryPorts(
      mergedPortMap,
      mergedAdapterBindings,
      classification.accepted,
    );
    mergedPortMap = repoSynthesis.portMap;
    mergedAdapterBindings = repoSynthesis.adapterBindings;
    const repositorySynthesisWarnings = repoSynthesis.synthesized.map(
      (s) =>
        `Auto-added a default repository port '${s.portName}' and adapter '${s.adapterName}' to context '${s.contextName}' — Stage 3 produced no outbound repository port (R03). Review and rename to fit your domain.`,
    );
    for (const warning of repositorySynthesisWarnings) {
      callbacks?.onChunk?.(`Stage 5 · ${warning}`);
    }

    // R12 satisfaction at the source: Stage 4 can give the same generic adapter
    // name to multiple contexts that share a technology (e.g. StripeClientAdapter
    // in two contexts) — a real codegen collision. Dedupe AFTER the R03 synthesis
    // (so the synthesized repository adapters are covered too) and on the same
    // mergedAdapterBindings Stage 5/6 read, so the reviewer never sees a duplicate
    // and the manifest carries globally-unique names. Only the adapter NAME
    // changes; `implements` (the port reference the gate keys on) is untouched.
    const adapterDedup = dedupeAdapterNames(mergedAdapterBindings);
    mergedAdapterBindings = adapterDedup.adapterBindings;
    const adapterRenameWarnings = adapterDedup.renamed.map(
      (r) =>
        `Renamed adapter '${r.from}' in context '${r.contextName}' to '${r.to}' to keep adapter names globally unique (R12).`,
    );
    for (const warning of adapterRenameWarnings) {
      callbacks?.onChunk?.(`Stage 5 · ${warning}`);
    }

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
    // reviewer repairs the *manifest*; we re-assemble (stages 2–5) and accept
    // the repair only if a DETERMINISTIC structural re-count strictly reduces
    // the error count — so a repair can never regress the user's manifest and
    // the gate is immune to non-deterministic LLM noise. No second Stage-6 call.
    // Every failure mode (model error, unparseable output, no improvement)
    // falls back to the original manifest + report.
    let finalManifest = assembledManifest;
    let finalReport: ValidationReport = s6.value;
    let repair: ManifestRepairSummary | undefined;

    // Surface the auto-added repository ports as advisory warnings. Done before
    // Stage 7 so the accept path (which preserves `finalReport.warnings`) and the
    // reject path both carry them. They are warnings, not errors, so `passed` and
    // the deterministic gate are unaffected.
    const assemblyAdvisories = [
      ...repositorySynthesisWarnings,
      ...adapterRenameWarnings,
    ];
    if (assemblyAdvisories.length > 0) {
      finalReport = {
        ...finalReport,
        warnings: [...finalReport.warnings, ...assemblyAdvisories],
      };
    }

    // R16/R17 are unrepairable by a manifest-level repair and can't be
    // reconstructed from a name-only manifest, so compare like for like — and
    // only engage the reviewer when a REPAIRABLE error actually remains. Gating
    // on the RAW count would burn a reviewer call on an all-R16/R17 report whose
    // stripped count is already 0 and the gate could never reduce. PR #344 review.
    const baselineReport = stripReconstructionArtifacts(s6.value);
    if (this.stage7 && baselineReport.errors.length > 0) {
      // neMotronBefore: the reviewer-visible error count (used only for the
      // "Stage 6 found N errors" chip — NOT for the gate, which uses the
      // deterministic count below to avoid LLM non-determinism).
      const neMotronBefore = baselineReport.errors.length;
      const warningsBefore = baselineReport.warnings.length;
      const beforeParsed =
        (assembledManifest.parsedObject as Record<string, unknown>) ?? {};
      const beforeCounts: EntityCounts = {
        ...countManifestEntities(beforeParsed),
        domainEntityCount: countDomainMembers(beforeParsed),
        contextNames: manifestContextNames(beforeParsed),
      };
      // Deterministic baseline: R01–R09 structural errors. Measure on the SAME
      // construction path as the post-repair count below — reassemble the
      // ORIGINAL manifest (buildPreDefinedPortMap), NOT the Stage-3 in-memory
      // mergedPortMap. The two disagree for an unchanged manifest: the rendered
      // manifest carries only port NAMES, so buildPreDefinedPortMap re-INFERS each
      // port's type from its name instead of reading Stage 3's explicit `type` —
      // e.g. an AI-derived repository port whose name doesn't look like one
      // re-reads as non-repository, a phantom R03. Comparing the Stage-3 basis
      // (before) against the reassembled basis (after) made a no-op repair look
      // like it ADDED structural errors (prod: 2→13 from one edit), so the gate
      // rejected every repair. Reassembling BOTH sides cancels that reconstruction
      // loss, so the gate sees only the repair's true delta. Falls back to the
      // merged structures if the baseline reassembly fails (keepOriginal-safe).
      const baselineReassembled = this.reassembleRepairedManifest(
        assembledManifest.parsedObject as unknown as StructuredConfig,
        { stage0: normalizedPrompt, stage1: domainAnalysis },
      );
      const deterministicBefore = baselineReassembled.success
        ? structuralManifestErrors(
            baselineReassembled.portMap,
            baselineReassembled.adapterBindings,
            beforeParsed,
          ).length
        : structuralManifestErrors(
            mergedPortMap,
            mergedAdapterBindings,
            beforeParsed,
          ).length;

      // A context-name change is only a legitimate repair when the baseline had
      // an R01 (banned-name) finding — the one rule whose fix renames a context.
      // Otherwise the gate requires the context-name SET preserved, rejecting a
      // count-preserving swap (delete A, add C). PR #344 review (qodo).
      const allowContextRename = baselineReport.errors.some((e) =>
        /^\[R01\]/.test(e),
      );
      const keepOriginal = (): ManifestRepairSummary => ({
        attempted: true,
        applied: false,
        errorsBefore: deterministicBefore,
        errorsAfter: deterministicBefore,
        warningsBefore,
        warningsAfter: warningsBefore,
      });

      callbacks?.onChunk?.(
        `Stage 6 found ${neMotronBefore} error${neMotronBefore !== 1 ? "s" : ""} — handing off to the reviewer model for Stage 7 verify-and-repair`,
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
        // The reviewer emits a small JSON OP-LIST (follow-up C), not a manifest.
        // We apply the ops DETERMINISTICALLY to the original manifest — no whole
        // artifact to mis-shape, no small edits to "drop". See RCA doc §8.
        const outputSnippet = repaired.value
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        const parsedOps = parseRepairOps(repaired.value);
        const rejected = parsedOps.rejected;
        let ops = parsedOps.ops;

        // Drop unjustified rename-context ops BEFORE applying. The gate would
        // reject an unjustified rename anyway — but applying it alongside good
        // additive ops makes the gate reject the WHOLE batch, so one gratuitous
        // rename (common LLM behavior) would zero out the legitimate fixes.
        if (!allowContextRename) {
          const renameCount = ops.filter(
            (o) => o.op === "rename-context",
          ).length;
          if (renameCount > 0) {
            ops = ops.filter((o) => o.op !== "rename-context");
            callbacks?.onChunk?.(
              `Stage 7 · ⚠ dropped ${renameCount} unjustified rename-context op${renameCount !== 1 ? "s" : ""} (no R01 finding warrants a rename)`,
            );
          }
        }

        if (ops.length === 0) {
          callbacks?.onChunk?.(
            "Stage 7 · Repair proposed no actionable edits — keeping the original manifest",
          );
          callbacks?.onChunk?.(
            `Stage 7 · (diagnostic) output began: ${outputSnippet}`,
          );
          repair = keepOriginal();
        } else {
          // Only meaningful once we have a usable op-list: invalid items inside a
          // parsed array (a fully unparseable blob is covered by the snippet above).
          if (rejected.length > 0) {
            callbacks?.onChunk?.(
              `Stage 7 · ⚠ ignored ${rejected.length} unrecognized item${rejected.length !== 1 ? "s" : ""} in the op-list`,
            );
          }
          callbacks?.onChunk?.("Stage 7 · Applying repair edits…");
          try {
            const applyResult = applyManifestOps(
              (assembledManifest.parsedObject as ManifestObject) ?? {},
              ops,
            );
            if (applyResult.skipped.length > 0) {
              const sample = applyResult.skipped
                .slice(0, 3)
                .map((s) => `${s.op.op} (${s.reason})`)
                .join("; ");
              callbacks?.onChunk?.(
                `Stage 7 · ⚠ ${applyResult.skipped.length} edit${applyResult.skipped.length !== 1 ? "s" : ""} not applied: ${sample}`,
              );
            }
            if (applyResult.applied === 0) {
              callbacks?.onChunk?.(
                `Stage 7 · No edits applied (all ${ops.length} skipped) — keeping the original manifest`,
              );
              repair = keepOriginal();
            } else {
              // Re-assemble the repaired manifest (stages 2–5 only; no second
              // LLM Stage-6 call — the gate uses structuralManifestErrors instead).
              const reassembled = this.reassembleRepairedManifest(
                applyResult.manifest as unknown as StructuredConfig,
                { stage0: normalizedPrompt, stage1: domainAnalysis },
              );
              if (!reassembled.success) {
                callbacks?.onChunk?.(
                  `Stage 7 · Re-assembly failed — keeping the original manifest (${summarizeError(reassembled.error)})`,
                );
                repair = keepOriginal();
              } else {
                const afterParsed =
                  (reassembled.manifest.parsedObject as Record<
                    string,
                    unknown
                  >) ?? {};
                // Deterministic structural re-count (R01–R09). Replaces the
                // previous second Stage-6 LLM call, removing the non-determinism
                // that caused 2→11 swings and the hidden ~53s latency.
                const afterStructuralErrors = structuralManifestErrors(
                  reassembled.portMap,
                  reassembled.adapterBindings,
                  afterParsed,
                );
                const deterministicAfter = afterStructuralErrors.length;
                const afterCounts: EntityCounts = {
                  ...countManifestEntities(afterParsed),
                  domainEntityCount: countDomainMembers(afterParsed),
                  contextNames: manifestContextNames(afterParsed),
                };
                const gate = evaluateRepairGate({
                  errorsBefore: deterministicBefore,
                  errorsAfter: deterministicAfter,
                  before: beforeCounts,
                  after: afterCounts,
                  allowContextRename,
                });

                repair = {
                  attempted: true,
                  applied: gate.applied,
                  errorsBefore: deterministicBefore,
                  errorsAfter: deterministicAfter,
                  warningsBefore,
                  warningsAfter: warningsBefore,
                };

                if (gate.applied) {
                  finalManifest = reassembled.manifest;
                  // Report = deterministic R01–R09 on the REPAIRED manifest, MERGED
                  // with the original review's NON-structural findings (R10–R18
                  // errors + all warnings). The repair only changed structure, so
                  // those are not stale; only the R01–R09 errors are superseded by
                  // the recount. Replacing the whole report with structural-only
                  // dropped the reviewer's warnings + semantic findings on accept —
                  // an accept-vs-reject regression (reject keeps the full report).
                  // (R16–R18 on a newly added/renamed port can be marginally stale;
                  // acceptable vs a total drop — recompute via
                  // collectPortQualityIssues if that becomes a problem.)
                  // Strip the structural rules the deterministic recount
                  // RE-PRODUCES (R01–R07, R09) and replace them with
                  // afterStructuralErrors. R08 is NOT stripped: the assembler
                  // always fills system/scope (extractScope + the workspaceName
                  // fallback), so deterministic R08 never fires post-assembly —
                  // stripping the LLM's R08 would silently drop it and flip
                  // passed→true. Preserve it (with R10–R18 + warnings).
                  const preservedErrors = finalReport.errors.filter(
                    (e) => !/^\[R0[1-7]\]|^\[R09\]/.test(e),
                  );
                  // Surface any adapter renames the repair-path dedupe made, the
                  // same way the initial Stage-5 pass does — so an accepted repair
                  // that introduced (and we resolved) a collision is visible.
                  const repairRenameWarnings = reassembled.adapterRenames.map(
                    (r) =>
                      `Renamed adapter '${r.from}' in context '${r.contextName}' to '${r.to}' to keep adapter names globally unique (R12).`,
                  );
                  finalReport = {
                    errors: [...afterStructuralErrors, ...preservedErrors],
                    warnings: [
                      ...finalReport.warnings,
                      ...repairRenameWarnings,
                    ],
                    passed:
                      afterStructuralErrors.length === 0 &&
                      preservedErrors.length === 0,
                  };
                  for (const warning of repairRenameWarnings) {
                    callbacks?.onChunk?.(`Stage 7 · ${warning}`);
                  }
                  callbacks?.onChunk?.(
                    `Stage 7 · Applied ${applyResult.applied} edit${applyResult.applied !== 1 ? "s" : ""} · repaired ${deterministicBefore - deterministicAfter} of ${deterministicBefore} structural finding${deterministicBefore !== 1 ? "s" : ""} — ${deterministicAfter} remain`,
                  );
                } else if (gate.reason === "no-error-reduction") {
                  // RCA §8 outcome (4): edits applied cleanly but didn't move the
                  // findings. Surface before/after structure so it's diagnosable
                  // (a no-op edit vs an applied-but-wrong one).
                  callbacks?.onChunk?.(
                    `Stage 7 · ${applyResult.applied} edit${applyResult.applied !== 1 ? "s" : ""} applied but findings not reduced (${deterministicAfter} after vs ${deterministicBefore} before) — keeping the original. before ${beforeCounts.portCount}p/${beforeCounts.adapterCount}a, after ${afterCounts.portCount}p/${afterCounts.adapterCount}a`,
                  );
                } else {
                  callbacks?.onChunk?.(
                    "Stage 7 · Repaired manifest shrank or drifted (contexts/ports/adapters) — keeping the original",
                  );
                }
              }
            }
          } catch (applyError) {
            callbacks?.onChunk?.(
              `Stage 7 · Could not apply the repair edits — keeping the original (${summarizeError(applyError)})`,
            );
            callbacks?.onChunk?.(
              `Stage 7 · (diagnostic) output began: ${outputSnippet}`,
            );
            repair = keepOriginal();
          }
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
   * Re-assemble a repaired MANIFEST for Stage 7. The manifest carries
   * `layers.application.ports` as string names (see draft-to-manifest.transform),
   * so buildPreDefinedPortMap reconstructs the real ports — unlike the raw
   * config, which for AI-generated-port specs has none. Classification (stage2),
   * context mappings and apps are all REBUILT from the repaired manifest so a
   * repair that renamed a context is validated faithfully and the re-assembled
   * manifest doesn't carry stale mapping endpoints from the original inputs
   * (PR #344 review). Only stage0 (intent / runtime concerns) and stage1 (domain
   * analysis, re-keyed to the repaired names) are reused, since a name-only
   * manifest can't reconstruct the domain model.
   *
   * Returns the assembled manifest plus the intermediate portMap/adapterBindings
   * so the DETERMINISTIC gate can check structural errors without a second LLM
   * call (the previous Stage-6 re-validation here caused the 2→11 non-determinism
   * swing and ~53s hidden latency — see docs/planning/stage7-deterministic-repair-gate.md).
   */
  private reassembleRepairedManifest(
    repairedManifest: StructuredConfig,
    base: {
      stage0: NormalizedPrompt;
      stage1: DomainAnalysis;
    },
  ):
    | {
        success: true;
        manifest: AssembledManifest;
        portMap: PortMap;
        adapterBindings: AdapterBindings;
        adapterRenames: RenamedAdapter[];
        discarded: Array<{ context: string; kind: string; raw: unknown }>;
      }
    | { success: false; error: unknown } {
    try {
      // Port/adapter entries the repair model emitted in a shape we couldn't turn
      // into a name (reported by the caller; the builders below skip them).
      const discarded = collectMalformedManifestEntries(repairedManifest);
      // Track context renames so Stage-5 re-attaches each context's domain model
      // (a rename otherwise orphans it — see rekeyDomainAnalysisToManifest).
      const stage1 = rekeyDomainAnalysisToManifest(
        base.stage1,
        repairedManifest,
      );
      const classification = buildClassificationFromConfig(
        repairedManifest,
        stage1,
      );
      const portMap = buildPreDefinedPortMap(repairedManifest);
      // Dedupe again on the repaired bindings: a repair can add adapters
      // (add-adapter ops) whose names collide with existing ones, and the
      // deterministic gate (R01–R09) does NOT enforce R12 — so without this an
      // accepted repair could re-introduce the adapter-name collision the
      // pre-Stage-5 dedupe removed. Same helper, same guarantee, on the repaired
      // assembly path.
      const adapterDedup = dedupeAdapterNames(
        buildPreDefinedAdapterBindings(repairedManifest, portMap),
      );
      const adapterBindings = adapterDedup.adapterBindings;
      // Derive mappings + apps from the REPAIRED manifest (not the original inputs)
      // so a renamed context doesn't leave the re-assembled manifest with mapping
      // endpoints pointing at the old name. Filter mappings to the repaired
      // manifest's own contexts, mirroring the first assembly pass's guard.
      const knownContextNorms = new Set(
        repairedManifest.bounded_contexts.flatMap((ctx) => {
          const names = [normalizeContextName(ctx.name)];
          if (ctx.short) names.push(normalizeContextName(ctx.short));
          return names;
        }),
      );
      const contextMappings = buildContextMappingsFromConfig(
        repairedManifest,
      ).filter(
        (m) =>
          knownContextNorms.has(normalizeContextName(m.upstream)) &&
          knownContextNorms.has(normalizeContextName(m.downstream)),
      );
      const apps = repairedManifest.apps ?? [];
      const manifest = this.stage5.execute({
        stage0: base.stage0,
        stage1,
        stage2: classification,
        stage3: portMap,
        stage4: adapterBindings,
        contextMappings,
        apps,
      });
      return {
        success: true,
        manifest,
        portMap,
        adapterBindings,
        adapterRenames: adapterDedup.renamed,
        discarded,
      };
    } catch (e) {
      return { success: false, error: e };
    }
  }
}
