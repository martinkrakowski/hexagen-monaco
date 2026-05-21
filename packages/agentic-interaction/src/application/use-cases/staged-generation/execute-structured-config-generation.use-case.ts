import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  DomainAnalysis,
  ClassificationResult,
  AssembledManifest,
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
  AdapterBindings,
  AdapterBinding,
} from "../../../domain/value-objects/pipeline-state";
import { normalizeContextName } from "../../../domain/index";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
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

interface StructuredConfigContext {
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
 * Parse a raw config string as YAML or JSON.
 * Attempts JSON first (fastest path for .json files).
 * Falls back to YAML for all other input.
 * Throws a descriptive error if neither parse succeeds.
 */
export function parseStructuredConfig(rawConfig: string): StructuredConfig {
  const trimmed = rawConfig.trimStart();

  // JSON fast path
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(rawConfig) as StructuredConfig;
      validateStructuredConfigShape(parsed);
      return parsed;
    } catch (e) {
      if (e instanceof StructuredConfigShapeError) throw e;
      // JSON parse failed — fall through to YAML
    }
  }

  // YAML path (covers .yaml, .yml, and malformed JSON)
  try {
    const parsed = yaml.load(rawConfig) as StructuredConfig;
    validateStructuredConfigShape(parsed);
    return parsed;
  } catch (e) {
    if (e instanceof StructuredConfigShapeError) throw e;
    throw new Error(
      `Failed to parse structured config as YAML or JSON. ` +
        `Ensure the file is valid YAML or JSON with a "bounded_contexts" array. ` +
        `Parser error: ${String(e)}`,
    );
  }
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

  const allTech = [
    ...new Set([
      ...techHints,
      ...deploymentTargets,
      ...frameworks,
      ...authSystems,
    ]),
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
    explicitTechnologies: allTech,
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
function inferContextType(
  ctx: StructuredConfigContext,
): AcceptedContext["type"] {
  // If the config explicitly declares a type, honour it
  if ("type" in ctx && ctx.type) {
    const declared = String(ctx.type).toLowerCase();
    if (declared === "core") return "core";
    if (declared === "supporting") return "supporting";
    if (declared === "generic") return "generic";
    if (declared === "shared-kernel" || declared === "shared_kernel")
      return "shared-kernel";
  }

  // Responsibility keyword heuristics
  const resp = (ctx.responsibility ?? ctx.name).toLowerCase();
  const name = ctx.name.toLowerCase();

  const supportingKeywords = [
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
  const genericKeywords = [
    "identity",
    "auth",
    "authentication",
    "authorization",
    "iam",
    "payment",
    "billing-gateway",
    "email",
  ];
  const sharedKernelKeywords = ["shared", "common", "kernel", "cross-cutting"];

  if (
    sharedKernelKeywords.some((kw) => name.includes(kw) || resp.includes(kw))
  ) {
    return "shared-kernel";
  }
  if (genericKeywords.some((kw) => name.includes(kw) || resp.includes(kw))) {
    return "supporting"; // identity/auth built in-house is supporting, not generic
  }
  if (supportingKeywords.some((kw) => name.includes(kw) || resp.includes(kw))) {
    return "supporting";
  }
  return "core";
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

    return {
      name: contextName,
      type: inferContextType(ctx),
      responsibility: ctx.responsibility ?? ctx.description ?? ctx.name,
      reasoning:
        ctx.responsibility ?? ctx.description ?? `Context: ${ctx.name}`,
      aggregateRoots: ctxAggregateRoots,
      useCaseNames: ctxUseCaseNames,
      eventsPublished: ctxEventsPublished,
      promotedFromUncertain: false,
      // Attach adapter hints as a non-standard field for Stage 3/4 prompt enrichment
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
    pattern: cm.pattern,
    mechanism: cm.mechanism,
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

function inferInboundPortType(name: string): InboundPortType {
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

function inferOutboundPortType(name: string): OutboundPortType {
  const l = name.toLowerCase();
  if (l.includes("reposit") || l.includes("repo")) return "repository";
  if (l.includes("publish") || l.includes("publisher")) return "publisher";
  if (l.includes("notif")) return "notifier";
  return "external-client";
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
          adapters: (ctx.layers?.infrastructure?.adapters ?? []).map(
            (name) => ({
              name,
              type: inferAdapterType(name) ?? "adapter",
              implements: inferAdapterImplements(name, portNames),
              adapterType: inferAdapterType(name),
            }),
          ),
        };
      }),
  };
}

export class ExecuteStructuredConfigGenerationUseCase {
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;
  private readonly transactionManager: TransactionManagerPort;

  constructor(
    llmPort: SendStructuredRequestPort,
    transactionManager: TransactionManagerPort,
  ) {
    this.stage3 = new ExecutePortMappingUseCase(llmPort);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
    this.transactionManager = transactionManager;
  }

  async execute(
    rawConfig: string,
    callbacks?: StructuredConfigGenerationCallbacks,
  ): Promise<
    | { success: true; value: AssembledManifest; transactionId: string }
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
        callbacks?.onChunk?.(
          `   ⚠ ${ctx.name}: LLM returned no ports — ${useCases.length > 0 ? "falling back to use_cases" : "leaving empty"}`,
        );
        if (useCases.length > 0) {
          fallbackContexts.push({
            contextName: ctx.name,
            in: useCases.map((uc) => ({
              name: `${uc.name}Port`,
              type: inferInboundPortType(uc.name),
              description: uc.command ?? uc.name,
            })),
            out: [],
          });
        }
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
        stage2: classification,
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

    // Create transaction for the generated manifest
    const intentId = `spec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const yaml = assembledManifest.yaml || "";
    const parsed =
      (assembledManifest.parsedObject as Record<string, unknown>) || {};

    let transaction: Awaited<ReturnType<TransactionManagerPort["begin"]>>;
    try {
      transaction = await this.transactionManager.begin(intentId, {
        intentId,
        origin: "structured-config-generation",
        yaml,
        contextCount: Array.isArray(parsed.bounded_contexts)
          ? parsed.bounded_contexts.length
          : 0,
        portCount: Array.isArray(parsed.ports)
          ? parsed.ports.length
          : Array.isArray(parsed.bounded_contexts)
            ? parsed.bounded_contexts.reduce(
                (sum, ctx) =>
                  sum +
                  (Array.isArray(ctx.ports?.in) ? ctx.ports.in.length : 0) +
                  (Array.isArray(ctx.ports?.out) ? ctx.ports.out.length : 0),
                0,
              )
            : 0,
        adapterCount: Array.isArray(parsed.bounded_contexts)
          ? (parsed.bounded_contexts as Array<Record<string, unknown>>).reduce(
              (sum, ctx) =>
                sum + (Array.isArray(ctx.adapters) ? ctx.adapters.length : 0),
              0,
            )
          : 0,
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
      value: assembledManifest,
      transactionId: transaction.id,
    };
  }
}
