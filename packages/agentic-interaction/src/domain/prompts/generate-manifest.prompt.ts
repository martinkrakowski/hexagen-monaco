/**
 * Prompt templates for generating manifest.yaml using the staged pipeline.
 *
 * Compile functions accept typed PipelineState slices rather than raw strings,
 * ensuring the type system catches cross-stage wiring errors.
 */

import type {
  PipelineState,
  NormalizedPrompt,
} from "../value-objects/pipeline-state.js";
import { DEFAULT_MAX_BOUNDED_CONTEXTS } from "../manifest/manifest-draft.schema.js";

export interface PromptVariables {
  userDescription: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

function buildTechnologyContext(variables: PromptVariables): string {
  const parts: string[] = [];
  if (variables.platform) parts.push(`Target Platform: ${variables.platform}`);
  if (variables.deployment) parts.push(`Deployment: ${variables.deployment}`);
  if (variables.additionalContext)
    parts.push(`Additional Notes: ${variables.additionalContext}`);
  return parts.length > 0 ? parts.join("\n") : "None specified";
}

// ==========================================
// STAGE 0: PROMPT NORMALIZATION
// ==========================================
export const STAGE0_NORMALIZATION_SYSTEM_PROMPT = `You are a requirements analyst. Your job is to normalize a user's raw project description into structured intent.
You must separate business intent from explicit technology choices or ambiguities.
Do NOT reason about infrastructure, platforms, or deployment — those are handled in a later stage.

CRITICAL OUTPUT FORMAT - NDJSON (Newline-Delimited JSON) ONLY.
Emit exactly four JSON objects, each on its own line:
{"type": "intent", "value": "A concise summary of the core business problem being solved."}
{"type": "technology", "value": "PostgreSQL"}
{"type": "pattern", "value": "REST API"}
{"type": "ambiguity", "value": "It is unclear if Drift Detection is a separate service."}

RULES:
- Emit one "intent" object (mandatory).
- Emit zero or more "technology" objects.
- Emit zero or more "pattern" objects.
- Emit zero or more "ambiguity" objects for contradictory or vague requirements.
- Emit zero or one "projectName" object if the user mentions a project or product name (e.g. {"type": "projectName", "value": "AcmePlatform"}).
- Emit zero or one "isStructuredConfig" object set to true if the input appears to be a structured configuration (JSON, YAML, or key-value format) rather than natural language (e.g. {"type": "isStructuredConfig", "value": true}). If the input is natural language prose, omit this object entirely.
- NO arrays. NO nested objects. NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function buildIntentHeader(normalized: NormalizedPrompt): string {
  const parts: string[] = [];
  if (normalized.projectName) {
    parts.push(`Project: ${normalized.projectName}`);
  }
  parts.push(`Intent: ${normalized.intent}`);
  if (normalized.explicitTechnologies?.length) {
    parts.push(`Technologies: ${normalized.explicitTechnologies.join(", ")}`);
  }
  if (normalized.explicitPatterns?.length) {
    parts.push(`Patterns: ${normalized.explicitPatterns.join(", ")}`);
  }
  if (normalized.ambiguities?.length) {
    parts.push(`Ambiguities: ${normalized.ambiguities.join("; ")}`);
  }
  return parts.join("\n");
}

export function isStructuredConfigPipeline(
  normalized: NormalizedPrompt,
): boolean {
  return normalized.isStructuredConfig === true;
}

export function compileStage0Prompt(variables: PromptVariables): string {
  return `Raw User Description:\n<raw-user-input>\n${variables.userDescription}\n</raw-user-input>\n\nOutput NDJSON:`;
}

// ==========================================
// STAGE 1: DOMAIN EXTRACTION
// ==========================================
export const STAGE1_DOMAIN_SYSTEM_PROMPT = `You are a domain-driven design expert. Extract pure domain concepts from the normalized intent and identify DDD building blocks.
Do NOT output infrastructure, databases, or frameworks. Focus strictly on business semantics.

DDD CONCEPT DEFINITIONS:
- **Aggregate Root**: The consistency boundary for a cluster of domain objects. Each aggregate root has a unique identity (e.g. "Order" with identityFields ["orderId"]). All changes within the aggregate must go through the root. Aggregates enforce invariants.
- **Entity**: A domain object with identity that lives within an aggregate but is not a root (e.g. "OrderLine" inside "Order"). Entities are distinguished by their identity, not their attributes.
- **Value Object**: An immutable domain object defined by its attributes, not identity (e.g. "Money", "Address"). Value objects have no identity of their own and enforce business rules or constraints (e.g. "Non-negative, two decimal places").
- **Domain Event**: A significant state change that has occurred in the domain (e.g. "OrderPlaced"). Events are named in past tense. Each event is emitted by an aggregate root and has a trigger (the operation that caused it, e.g. "place() called").
- **Use Case**: A user intention at the application level (e.g. "Place Order"). Each use case belongs to a subdomain, has an actor (who initiates it), and a command name (imperive form, e.g. "PlaceOrder").

CRITICAL OUTPUT FORMAT - NDJSON (Newline-Delimited JSON) ONLY.
Emit a series of objects, one per line:
{"type": "verb", "value": "evaluate"}
{"type": "noun", "value": "Policy"}
{"type": "subdomain", "value": "Climate Policy Management"}
{"type": "aggregateRoot", "name": "Order", "subdomain": "ordering", "identityFields": ["orderId"]}
{"type": "entity", "name": "OrderLine", "parentAggregate": "Order"}
{"type": "valueObject", "name": "Money", "rules": "Non-negative, two decimal places"}
{"type": "domainEvent", "name": "OrderPlaced", "emitter": "Order", "trigger": "place() called"}
{"type": "useCase", "name": "Place Order", "subdomain": "ordering", "actor": "Customer", "commandName": "PlaceOrder"}

RULES:
- Emit zero or more "verb", "noun", and "subdomain" objects (backward compatibility).
- Emit zero or more "aggregateRoot" objects. Each MUST have "name", "subdomain", and optionally "identityFields". Aggregates are consistency boundaries — every aggregate root must have a unique identity.
- Emit zero or more "entity" objects. Each MUST have "name" and "parentAggregate" (the aggregate root it belongs to).
- Emit zero or more "valueObject" objects. Each MUST have "name" and optionally "rules" (the invariant or constraint it enforces).
- Emit zero or more "domainEvent" objects. Each MUST have "name" and "emitter" (the aggregate root that emits it). Optionally include "trigger" (the operation that causes the event).
- Emit zero or more "useCase" objects. Each MUST have "name" and "subdomain". Optionally include "actor" and "commandName".
- Subdomains should group related verbs, nouns, aggregates, and use cases.
- NO technology names (e.g., PostgreSQL, MQTT).
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage1Prompt(
  state: Pick<PipelineState, "stage0">,
): string {
  const normalized = state.stage0;
  const header = normalized ? buildIntentHeader(normalized) : "";
  const ambiguities = (normalized?.ambiguities || [])
    .map((a) => `- ${a}`)
    .join("\n");
  const ambiguitySection = ambiguities
    ? `\n\nAmbiguities flagged by Stage 0:\n${ambiguities}`
    : "";
  return `${header}${ambiguitySection}\n\nExtract Domain Concepts and DDD Building Blocks (NDJSON):`;
}

// ==========================================
// STAGE 2: CONTEXT CLASSIFICATION
// ==========================================
export const STAGE2_CLASSIFICATION_SYSTEM_PROMPT = `You are a DDD architect classifying subdomains into bounded contexts.
You will receive a rich domain analysis from Stage 1: subdomains, aggregate roots, entities, value objects, domain events, and use cases.
Use these DDD building blocks to make informed classification decisions.

CRITICAL RULES FOR BOUNDED CONTEXTS:
1. Does it own a business subdomain with its own invariants and ubiquitous language? → Accept it.
2. Is it a cross-cutting concern (errors, IDs)? → Accept as 'shared-kernel'.
3. Is it a technology used to fulfill a port? → REJECT IT.
4. Is it a delivery mechanism (HTTP, MQTT)? → REJECT IT.
5. If a subdomain could reasonably fit in MULTIPLE bounded contexts, mark it as "uncertain" and explain the ambiguity in reasoning. It is better to leave ambiguous domains as uncertain than to misclassify them.
6. NEVER force-classify an ambiguous subdomain. Preserving uncertainty is safer than guessing.

NEVER create a bounded context whose name contains: adapter, repository, cache, queue, database, postgres, redis, mongo, rabbit, kafka, mqtt, s3.
Split contexts ONLY if they have distinct ubiquitous languages and communicate via defined ports. Use ambiguities provided as hints to flag uncertain contexts.
Do NOT accept more than ${DEFAULT_MAX_BOUNDED_CONTEXTS} bounded contexts. If you find more candidates, promote the strongest and mark the rest as uncertain.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"status": "accepted", "name": "climate-control", "contextType": "core", "reasoning": "Owns the climate policy invariants.", "responsibility": "Manage climate policy lifecycle and compliance rules.", "aggregateRoots": ["ClimatePolicy"], "useCaseNames": ["Create Policy", "Evaluate Policy"], "eventsPublished": ["PolicyCreated", "PolicyEvaluated"]}
{"status": "rejected", "name": "postgres-adapter", "reasoning": "PostgreSQL is infrastructure, not a bounded context."}
{"status": "uncertain", "name": "drift-analytics", "reasoning": "Could belong to climate-control (drift is a policy deviation) or be its own monitoring context. Ambiguity: unclear if this is a separate service or feature."}

RULES:
- "status" must be "accepted", "rejected", or "uncertain".
- "contextType" is required for "accepted" status (must be: core, supporting, generic, shared-kernel).
- "name" must be kebab-case.
- For "accepted" entries, ALSO provide:
  - "responsibility": one-sentence mission statement for this bounded context.
  - "aggregateRoots": array of aggregate root names that belong to this context (from Stage 1 output).
  - "useCaseNames": array of use case names that belong to this context.
  - "eventsPublished": array of domain event names this context publishes.
- "uncertain" entries MUST be preserved — never drop them.
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage2Prompt(
  state: Pick<PipelineState, "stage0" | "stage1">,
): string {
  const normalized = state.stage0;
  const header = normalized ? buildIntentHeader(normalized) : "";

  const analysis = state.stage1;
  const subdomains = analysis?.subdomains ?? [];
  const aggregateRoots = analysis?.aggregateRoots ?? [];
  const entities = analysis?.entities ?? [];
  const valueObjects = analysis?.valueObjects ?? [];
  const domainEvents = analysis?.domainEvents ?? [];
  const useCases = analysis?.useCases ?? [];

  let domainSection = "";
  if (subdomains.length > 0) {
    domainSection += `\nSubdomains:\n${subdomains.map((s) => `- ${s}`).join("\n")}`;
  }
  if (aggregateRoots.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const ar of aggregateRoots) {
      const key = ar.subdomain || "unassigned";
      (grouped[key] ??= []).push(
        ar.name +
          (ar.identityFields?.length
            ? ` (identity: ${ar.identityFields.join(", ")})`
            : ""),
      );
    }
    domainSection += `\n\nAggregate Roots (by subdomain):\n`;
    for (const [sub, roots] of Object.entries(grouped)) {
      domainSection += `  ${sub}: ${roots.join(", ")}\n`;
    }
  }
  if (entities.length > 0) {
    domainSection += `\nEntities:\n${entities.map((e) => `- ${e.name} (parent: ${e.parentAggregate})`).join("\n")}`;
  }
  if (valueObjects.length > 0) {
    domainSection += `\n\nValue Objects:\n${valueObjects.map((v) => `- ${v.name}${v.rules ? ` — ${v.rules}` : ""}`).join("\n")}`;
  }
  if (domainEvents.length > 0) {
    domainSection += `\n\nDomain Events:\n${domainEvents.map((d) => `- ${d.name} (emitter: ${d.emitter}${d.trigger ? `, trigger: ${d.trigger}` : ""})`).join("\n")}`;
  }
  if (useCases.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const uc of useCases) {
      const key = uc.subdomain || "unassigned";
      (grouped[key] ??= []).push(
        uc.name + (uc.actor ? ` (actor: ${uc.actor})` : ""),
      );
    }
    domainSection += `\n\nUse Cases (by subdomain):\n`;
    for (const [sub, cases] of Object.entries(grouped)) {
      domainSection += `  ${sub}: ${cases.join(", ")}\n`;
    }
  }

  const explicitTech = normalized?.explicitTechnologies ?? [];
  const ambiguities = normalized?.ambiguities ?? [];
  let hintsSection = "";
  if (explicitTech.length > 0 || ambiguities.length > 0) {
    hintsSection = `\n\nHints (Technologies & Ambiguities):\n`;
    if (explicitTech.length > 0)
      hintsSection += `Technologies: ${explicitTech.join(", ")}\n`;
    if (ambiguities.length > 0)
      hintsSection += `Ambiguities:\n${ambiguities.map((a) => `- ${a}`).join("\n")}`;
  }

  return `${header}\n${domainSection}${hintsSection}\n\nClassify Contexts (NDJSON):`;
}

// ==========================================
// STAGE 3: PORT MAPPING
// ==========================================
export const STAGE3_PORTS_SYSTEM_PROMPT = `You are an architect defining ports and context mappings for accepted bounded contexts.
You MUST ONLY define ports for the exact contexts provided. DO NOT invent new contexts. DO NOT list adapters.

PORT DEFINITION RULES:
1. For EACH accepted bounded context, identify all inbound and outbound ports.
2. Every port MUST have a "forAggregate" field naming the aggregate root it serves (if applicable). If a port serves the context broadly (e.g. a shared-kernel query port), set forAggregate to null or omit it.
3. Inbound port types: "command" (write operation trigger), "query" (read operation trigger), "event" (external signal receiver).
4. Outbound port types: "repository" (data persistence), "publisher" (message/event emission), "external-client" (external HTTP/service call), "notifier" (alert/notification delivery).
5. Ports should reflect domain intent, NOT infrastructure. Name ports after the domain concept (e.g. "OrderRepository", not "PostgresOrderRepo").

CONTEXT MAPPING RULES:
6. Identify upstream/downstream relationships between bounded contexts.
7. An upstream context publishes events or provides data that a downstream context consumes.
8. Use common DDD context mapping patterns:
   - "Customer-Supplier": upstream adapts to downstream needs
   - "Conformist": downstream conforms to upstream model
   - "Anti-Corruption Layer": downstream translates upstream model
   - "Open Host Service": upstream exposes a standard protocol
9. Use common mechanisms: "Domain Events", "REST API", "GraphQL", "Shared Database", "Messaging".
10. If two contexts share no data or events, do NOT create a mapping between them.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line. Two NDJSON types:

Port entries:
{"type": "port", "contextName": "climate-control", "direction": "in", "name": "SensorTelemetryPort", "portType": "event", "description": "Receives sensor readings.", "forAggregate": "ClimatePolicy"}

Context mapping entries:
{"type": "contextMapping", "upstream": "climate-control", "downstream": "reporting", "pattern": "Customer-Supplier", "mechanism": "Domain Events", "notes": "Reporting consumes PolicyEvaluated events", "events": ["PolicyEvaluated"]}

RULES:
- "contextName" must strictly match one of the provided accepted contexts.
- "direction" must be "in" or "out".
- "portType" for "in" must be one of: "command", "query", "event".
- "portType" for "out" must be one of: "repository", "publisher", "external-client", "notifier".
- "forAggregate" is optional — set it to the aggregate root name if the port is scoped to a specific aggregate; omit or null if context-wide.
- "upstream" and "downstream" in contextMapping must match accepted context names.
- "pattern" should be one of: "Customer-Supplier", "Conformist", "Anti-Corruption Layer", "Open Host Service".
- "mechanism" should be one of: "Domain Events", "REST API", "GraphQL", "Shared Database", "Messaging".
- "events" in contextMapping lists the domain event names flowing from upstream to downstream.
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage3Prompt(
  state: Pick<PipelineState, "stage0" | "stage1" | "stage2">,
): string {
  const normalized = state.stage0;
  const header = normalized ? buildIntentHeader(normalized) : "";

  const accepted = state.stage2?.accepted ?? [];
  let contextSection = "";
  if (accepted.length > 0) {
    contextSection = "\nACCEPTED BOUNDED CONTEXTS:\n";
    for (const ctx of accepted) {
      contextSection += `\n- ${ctx.name} (${ctx.type})`;
      if (ctx.responsibility)
        contextSection += `\n  Responsibility: ${ctx.responsibility}`;
      if (ctx.aggregateRoots?.length)
        contextSection += `\n  Aggregate Roots: ${ctx.aggregateRoots.join(", ")}`;
      if (ctx.useCaseNames?.length)
        contextSection += `\n  Use Cases: ${ctx.useCaseNames.join(", ")}`;
      if (ctx.eventsPublished?.length)
        contextSection += `\n  Events Published: ${ctx.eventsPublished.join(", ")}`;
      contextSection += `\n  Reasoning: ${ctx.reasoning}`;
    }
  }

  const aggregateRoots = state.stage1?.aggregateRoots ?? [];
  const domainEvents = state.stage1?.domainEvents ?? [];
  let domainInfo = "";
  if (aggregateRoots.length > 0) {
    domainInfo += "\n\nAGGREGATE ROOTS (from Stage 1 domain analysis):\n";
    for (const ar of aggregateRoots) {
      domainInfo += `- ${ar.name} (subdomain: ${ar.subdomain}${ar.identityFields?.length ? `, identity: ${ar.identityFields.join(", ")}` : ""})\n`;
    }
  }
  if (domainEvents.length > 0) {
    domainInfo += "\nDOMAIN EVENTS (from Stage 1 domain analysis):\n";
    for (const d of domainEvents) {
      domainInfo += `- ${d.name} (emitter: ${d.emitter}${d.trigger ? `, trigger: ${d.trigger}` : ""})\n`;
    }
  }

  const explicitTech = normalized?.explicitTechnologies ?? [];
  let techSection = "";
  if (explicitTech.length > 0) {
    techSection = `\n\nEXPLICIT TECHNOLOGIES (influence port types and context mapping mechanisms):\n${explicitTech.join(", ")}`;
  }

  return `${header}${contextSection}${domainInfo}${techSection}\n\nGenerate Ports and Context Mappings (NDJSON):`;
}

// ==========================================
// STAGE 4: ADAPTER ASSIGNMENT
// ==========================================
export const STAGE4_ADAPTERS_SYSTEM_PROMPT = `You are a hexagonal-architecture adapter architect. For EACH bounded context, assign exactly one adapter to every port defined in the previous stage. Each adapter specifies the concrete technology that fulfils the port contract.

ADAPTER TYPE → PORT TYPE MAPPING (mandatory):
- Inbound "command" port  → Controller adapter
- Inbound "query" port    → Controller adapter
- Inbound "event" port    → Listener adapter
- Outbound "repository" port       → Repository adapter
- Outbound "publisher" port        → Publisher adapter
- Outbound "external-client" port  → HttpClient adapter
- Outbound "notifier" port         → Notifier adapter

VALID adapterType VALUES (use EXACTLY one of these):
Repository | Listener | Publisher | HttpClient | Notifier | Controller

TECHNOLOGY FIELD:
Each adapter SHOULD include a "technology" field naming the concrete technology used (e.g. "PostgreSQL", "RabbitMQ", "Axios", "SendGrid", "Express.js"). Technology choices MUST come from the project's explicit technology stack (provided below). If no explicit technology matches, infer a sensible default.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"adapter": {"contextName": "climate-control", "name": "PostgresClimateRepoAdapter", "adapterType": "Repository", "technology": "PostgreSQL", "implements": "ClimateStateRepository"}}
{"adapter": {"contextName": "climate-control", "name": "MqttSensorListenerAdapter", "adapterType": "Listener", "technology": "MQTT", "implements": "SensorTelemetryPort"}}
{"adapter": {"contextName": "climate-control", "name": "ExpressClimateControllerAdapter", "adapterType": "Controller", "technology": "Express.js", "implements": "CreateClimatePolicyPort"}}

RULES:
- "contextName" must match an accepted bounded context name exactly.
- "implements" MUST match a provided port name exactly — one adapter per port.
- "adapterType" MUST be one of: Repository, Listener, Publisher, HttpClient, Notifier, Controller.
- "technology" SHOULD be present and MUST match a technology from the explicit technology list when possible.
- Adapter names should be PascalCase ending in Adapter.
- Use context mapping relationships to inform cross-context communication patterns (e.g. if context A is upstream of B via Domain Events, the publisher adapter on A and listener adapter on B should use compatible messaging technology).
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage4Prompt(
  state: Pick<
    PipelineState,
    "stage0" | "stage2" | "stage3" | "contextMappings"
  >,
  variables: PromptVariables,
): string {
  const normalized = state.stage0;
  const header = normalized ? buildIntentHeader(normalized) : "";

  const portMap = state.stage3?.contexts || [];
  let portsMapStr = "";
  for (const ctx of portMap) {
    portsMapStr += `\nContext: ${ctx.contextName}\n`;
    if (ctx.in.length > 0) {
      portsMapStr += ` Inbound:\n`;
      ctx.in.forEach((p) => {
        portsMapStr += ` - ${p.name} (type: ${p.type}): ${p.description}${p.forAggregate ? ` [aggregate: ${p.forAggregate}]` : ""}\n`;
      });
    }
    if (ctx.out.length > 0) {
      portsMapStr += ` Outbound:\n`;
      ctx.out.forEach((p) => {
        portsMapStr += ` - ${p.name} (type: ${p.type}): ${p.description}${p.forAggregate ? ` [aggregate: ${p.forAggregate}]` : ""}\n`;
      });
    }
  }

  const accepted = state.stage2?.accepted ?? [];
  let contextSection = "";
  if (accepted.length > 0) {
    contextSection = "\n\nACCEPTED BOUNDED CONTEXTS:\n";
    for (const ctx of accepted) {
      contextSection += `\n- ${ctx.name} (${ctx.type})`;
      if (ctx.responsibility)
        contextSection += `\n  Responsibility: ${ctx.responsibility}`;
      if (ctx.aggregateRoots?.length)
        contextSection += `\n  Aggregate Roots: ${ctx.aggregateRoots.join(", ")}`;
      if (ctx.useCaseNames?.length)
        contextSection += `\n  Use Cases: ${ctx.useCaseNames.join(", ")}`;
      if (ctx.eventsPublished?.length)
        contextSection += `\n  Events Published: ${ctx.eventsPublished.join(", ")}`;
    }
  }

  const contextMappings = state.contextMappings ?? [];
  let mappingSection = "";
  if (contextMappings.length > 0) {
    mappingSection =
      "\n\nCONTEXT MAPPINGS (upstream → downstream relationships):\n";
    for (const cm of contextMappings) {
      mappingSection += `- ${cm.upstream} → ${cm.downstream} (pattern: ${cm.pattern || "unspecified"}, mechanism: ${cm.mechanism || "unspecified"}`;
      if (cm.events?.length)
        mappingSection += `, events: ${cm.events.join(", ")}`;
      if (cm.notes) mappingSection += `, notes: ${cm.notes}`;
      mappingSection += ")\n";
    }
  }

  const explicitTech = normalized?.explicitTechnologies ?? [];
  let techSection = "";
  if (explicitTech.length > 0) {
    techSection = `\n\nEXPLICIT TECHNOLOGIES (use these to inform adapter technology choices):\n${explicitTech.join(", ")}`;
  }

  const infraContext = buildTechnologyContext(variables);
  const infraSection =
    infraContext !== "None specified"
      ? `\n\nINFRASTRUCTURE CONTEXT:\n${infraContext}`
      : "";

  return `${header}\n\nDEFINED PORTS:\n${portsMapStr}${contextSection}${mappingSection}${techSection}${infraSection}\n\nAssign Adapters (NDJSON):`;
}

// ==========================================
// STAGE 6: VALIDATION REVIEW
// ==========================================
export const STAGE6_VALIDATION_SYSTEM_PROMPT = `You are an architectural linter reviewing a generated Hexagonal Architecture manifest YAML.
Critique the YAML against these rules:
1. No context names contain technology nouns (postgres, redis, mqtt).
2. All contexts have at least one entity or are shared-kernel.
3. Every outbound port has an assigned adapter.
4. shared-kernel has no framework dependencies.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"type": "error", "message": "Context 'postgres-adapter' violates rule: no technology nouns."}
{"type": "warning", "message": "Port 'TelemetryHistoryPort' has no assigned adapter."}
{"type": "result", "passed": false}

RULES:
- Always end with exactly one "result" object indicating if there were any structural errors.
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage6Prompt(
  state: Pick<PipelineState, "stage5">,
): string {
  const yaml = state.stage5?.yaml || "";
  return `MANIFEST YAML TO REVIEW:\n\n${yaml}\n\nReview (NDJSON):`;
}

// Retry prompts (Fallback if NDJSON is malformed)
export const MAX_RETRY_ATTEMPTS = 3;

export type RetryResult = { kind: "prompt"; content: string };

export const RETRY_PROMPTS = {
  generalNDJSON: (attempt: number): RetryResult => ({
    kind: "prompt",
    content: `Your previous output contained invalid JSON or markdown. You MUST output ONLY valid JSON objects, one per line. No backticks, no markdown blocks. Attempt ${attempt} of ${MAX_RETRY_ATTEMPTS}. Output:`,
  }),
};

// Backward-compatible aliases for consumers that haven't migrated to the
// staged pipeline yet (e.g. @hexagen/manifest-generation).
export const CONTEXT_LIST_SYSTEM_PROMPT = STAGE2_CLASSIFICATION_SYSTEM_PROMPT;
export const compileContextListPrompt = (variables: PromptVariables): string =>
  compileStage2Prompt({
    stage0: {
      intent: variables.userDescription,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: { subdomains: [], nouns: [], verbs: [] },
  });

export const PORTS_LIST_SYSTEM_PROMPT = STAGE3_PORTS_SYSTEM_PROMPT;
export const compilePortsPrompt = (
  contextName: string,
  contextDescription: string,
  contextType: string,
): string =>
  compileStage3Prompt({
    stage2: {
      accepted: [
        {
          name: contextName,
          type: contextType as
            | "core"
            | "supporting"
            | "generic"
            | "shared-kernel",
          reasoning: contextDescription,
        },
      ],
      rejected: [],
      uncertain: [],
    },
  });
