import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  DomainAnalysis,
  ClassificationResult,
  AssembledManifest,
  NormalizedPrompt,
  ContextMappingEntry,
  AggregateRoot,
  DomainEntity,
  DomainValueObject,
  DomainEvent,
  AcceptedContext,
  PipelineState,
} from "../../../domain/value-objects/pipeline-state.js";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case.js";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case.js";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case.js";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
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

type StageResult<T> =
  | { success: true; value: T }
  | { success: false; error: unknown };

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
    for (const uc of ucs) {
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
    const ctxAggregateRoots = (domainAnalysis.aggregateRoots ?? [])
      .filter((ar) => ar.subdomain === contextName)
      .map((ar) => ar.name);

    // Use case names belonging to this context
    const ctxUseCaseNames = (domainAnalysis.useCases ?? [])
      .filter((uc) => uc.subdomain === contextName)
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
      responsibility: ctx.responsibility ?? ctx.name,
      reasoning:
        ctx.responsibility ?? `Extracted from structured config: ${ctx.name}`,
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

// Module-level cache — survives across request instances within the same process
const CONFIG_CACHE = new Map<string, AssembledManifest>();
const MAX_CACHE_SIZE = 50;

function configCacheKey(rawConfig: string): string {
  // Simple djb2 hash — fast, no crypto dependency
  let hash = 5381;
  for (let i = 0; i < rawConfig.length; i++) {
    hash = (hash * 33) ^ rawConfig.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function cacheGet(rawConfig: string): AssembledManifest | undefined {
  return CONFIG_CACHE.get(configCacheKey(rawConfig));
}

function cacheSet(rawConfig: string, result: AssembledManifest): void {
  if (CONFIG_CACHE.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (Map preserves insertion order)
    const firstKey = CONFIG_CACHE.keys().next().value;
    if (firstKey !== undefined) CONFIG_CACHE.delete(firstKey);
  }
  CONFIG_CACHE.set(configCacheKey(rawConfig), result);
}

export class ExecuteStructuredConfigGenerationUseCase {
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;

  constructor(llmPort: SendStructuredRequestPort) {
    this.stage3 = new ExecutePortMappingUseCase(llmPort);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
  }

  async execute(
    rawConfig: string,
    callbacks?: StructuredConfigGenerationCallbacks,
  ): Promise<StageResult<AssembledManifest>> {
    // Idempotency check
    const cached = cacheGet(rawConfig);
    if (cached) {
      callbacks?.onProgress?.(0, 0);
      callbacks?.onProgress?.(1, 0);
      callbacks?.onProgress?.(2, 0);
      callbacks?.onProgress?.(3, 0);
      callbacks?.onProgress?.(4, 0);
      callbacks?.onProgress?.(5, 0);
      callbacks?.onProgress?.(6, 0);
      return { success: true, value: cached };
    }

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

    // Build pipeline state for Stage 3 onward
    const pipelineState: Pick<
      PipelineState,
      "stage0" | "stage1" | "stage2" | "contextMappings"
    > = {
      stage0: normalizedPrompt,
      stage1: domainAnalysis,
      stage2: classification,
      contextMappings,
    };

    // Stage 3: Port Mapping (LLM)
    const s3Start = Date.now();
    callbacks?.onProgress?.(3, 0);
    const s3 = await this.stage3.execute(pipelineState, callbacks?.onChunk);
    const s3Duration = Date.now() - s3Start;
    if (!s3.success) {
      callbacks?.onError?.(3, String(s3.error), s3Duration);
      return { success: false, error: s3.error };
    }
    callbacks?.onProgress?.(3, s3Duration);

    // Stage 4: Adapter Assignment
    const s4Start = Date.now();
    callbacks?.onProgress?.(4, 0);
    const variables: PromptVariables = {
      userDescription: rawConfig, // Pass original config — Stage 4 prompt will XML-wrap it
      deployment: (config.apps ?? [])
        .map((a) => a.deployment)
        .filter(Boolean)
        .join(", "),
    };
    const s4 = await this.stage4.execute(
      { stage0: normalizedPrompt, stage3: s3.value.portMap },
      variables,
      callbacks?.onChunk,
    );
    const s4Duration = Date.now() - s4Start;
    if (!s4.success) {
      callbacks?.onError?.(4, String(s4.error), s4Duration);
      return { success: false, error: s4.error };
    }
    callbacks?.onProgress?.(4, s4Duration);

    // Stage 5: Manifest Assembly (synchronous, returns AssembledManifest directly)
    const s5Start = Date.now();
    callbacks?.onProgress?.(5, 0);
    const assembledManifest = this.stage5.execute({
      stage0: normalizedPrompt,
      stage2: classification,
      stage3: s3.value.portMap,
      stage4: s4.value,
      contextMappings,
    });
    const s5Duration = Date.now() - s5Start;
    callbacks?.onProgress?.(5, s5Duration);

    // Stage 6: Validation Review
    const s6Start = Date.now();
    callbacks?.onProgress?.(6, 0);
    const s6 = await this.stage6.execute(
      {
        stage0: normalizedPrompt,
        stage2: classification,
        stage5: assembledManifest,
        contextMappings,
      },
      callbacks?.onChunk,
    );
    const s6Duration = Date.now() - s6Start;
    if (!s6.success) {
      callbacks?.onError?.(6, String(s6.error), s6Duration);
      return { success: false, error: s6.error };
    }
    callbacks?.onProgress?.(6, s6Duration);

    // Cache successful result
    cacheSet(rawConfig, assembledManifest);

    return { success: true, value: assembledManifest };
  }
}
