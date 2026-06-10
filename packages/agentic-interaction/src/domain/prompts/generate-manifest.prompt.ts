/**
 * Prompt templates for generating manifest.yaml using the staged pipeline.
 *
 * Compile functions accept typed PipelineState slices rather than raw strings,
 * ensuring the type system catches cross-stage wiring errors.
 */

/**
 * INJECTION PROTECTION CONTRACT
 *
 * All compile functions in this file follow these rules:
 *
 * 1. User-originated text (from variables.userDescription or any string
 *    that has passed through user input) is ALWAYS wrapped in XML tags
 *    before injection into a prompt string:
 *
 *    `<user_input>\n${variables.userDescription}\n</user_input>`
 *
 * 2. The instruction line ("Output NDJSON:", "Return JSON:") ALWAYS
 *    appears after the final closing XML tag. Instructions inside
 *    delimited blocks are not followed by most models.
 *
 * 3. Stage outputs from previous stages are wrapped in named tags:
 *    <original_intent>, <domain_analysis>, <accepted_contexts>,
 *    <defined_ports>, <manifest_yaml>, <assembly_warnings>,
 *    <promoted_from_uncertain>, <context_mappings>.
 *
 * 4. The ProjectDescriptionValidator.DANGEROUS_PATTERNS list is the
 *    first gate. XML delimiters are the second gate. Together they
 *    provide defence-in-depth against prompt injection.
 *
 * When adding a new compile function, all four rules are mandatory.
 */

import type {
  NormalizedPrompt,
  PipelineState,
} from "../value-objects/pipeline-state.ts";
import { DEFAULT_MAX_BOUNDED_CONTEXTS } from "../manifest/manifest-draft.schema";
import { CONTEXT_NAME_GENERATION_BANS } from "./architecture-contract";
import { MAX_RETRY_ATTEMPTS } from "../errors/stage-errors";
import { escapeXml } from "./escape-xml";
import type { BoundedContextType } from "@hexagen/shared";
export { MAX_RETRY_ATTEMPTS } from "../errors/stage-errors";

export interface PromptVariables {
  userDescription: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

function buildTechnologyContext(variables: PromptVariables): string {
  const parts: string[] = [];
  if (variables.platform)
    parts.push(
      `<technology_context>Target Platform: ${escapeXml(variables.platform)}</technology_context>`,
    );
  if (variables.deployment)
    parts.push(
      `<technology_context>Deployment: ${escapeXml(variables.deployment)}</technology_context>`,
    );
  if (variables.additionalContext)
    parts.push(
      `<technology_context>Additional Notes: ${escapeXml(variables.additionalContext)}</technology_context>`,
    );
  return parts.length > 0 ? parts.join("\n") : "None specified";
}

// ==========================================
// STAGE 0: PROMPT NORMALIZATION
// ==========================================
export const STAGE0_NORMALIZATION_SYSTEM_PROMPT = `You are a requirements analyst. Your job is to normalize a user's raw project description into structured intent.
You must separate business intent from explicit technology choices or ambiguities.
Do NOT reason about infrastructure, platforms, or deployment — those are handled in a later stage.

CRITICAL OUTPUT FORMAT - NDJSON (Newline-Delimited JSON) ONLY.
Emit one JSON object per line, following the RULES below. Example output:
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

export function compileStage0Prompt(
  variables: PromptVariables,
  architectureContext?: string,
): string {
  // The architecture block is trusted static content built by
  // buildGreenfieldArchitectureContext() (T2b) — deliberately NOT escapeXml'd,
  // unlike the untrusted user input below. Absent (the default), the compiled
  // prompt is byte-identical to the pre-T2b output, so existing prompt
  // snapshots stay valid.
  const architectureBlock = architectureContext
    ? `<architecture>\n${architectureContext}\n</architecture>\n\n`
    : "";
  return `${architectureBlock}Raw User Description:\n<user_input>\n${escapeXml(variables.userDescription)}\n</user_input>\n\nOutput NDJSON:`;
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

DECOMPOSITION REQUIREMENT:
- Decompose the domain into MULTIPLE subdomains — one per distinct business capability. Do NOT merge the whole system into a single subdomain (e.g. for a blog platform, "user-accounts" and "content-management" are SEPARATE subdomains, never one "Blog Management").
- A typical system has 3-6 subdomains. Emit one "subdomain" line per capability.
- Every aggregateRoot and useCase must name the subdomain it belongs to.

RULES:
- Emit zero or more "verb" and "noun" objects (backward compatibility), and one "subdomain" object per distinct business capability (see DECOMPOSITION REQUIREMENT).
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
  return `<original_intent>\n${header}${ambiguitySection}\n</original_intent>\n\nExtract Domain Concepts and DDD Building Blocks (NDJSON):`;
}

/** Appended to STAGE1_DOMAIN_SYSTEM_PROMPT for the draft→refine cascade
 * (fast drafting model → stronger refiner reviewing the draft). Wording is
 * exactly what the cascade probes validated — 8/8 valid NDJSON from both
 * refiners tested (docs/planning/mercury-2-swap-investigation.md §7–8). */
export const STAGE1_REFINEMENT_MODE_SUFFIX = `

REFINEMENT MODE:
You will receive a DRAFT domain analysis (NDJSON) produced by another model.
Review it against the user's description: fix wrong or merged subdomains,
add missing subdomains/aggregates/useCases, remove redundant lines. Re-emit
the COMPLETE corrected analysis as NDJSON — same line formats as above. Do
not include commentary.`;

export function compileStage1RefinementUserPrompt(
  originalPrompt: string,
  draftNdjson: string,
): string {
  return `${originalPrompt}\n\nDRAFT ANALYSIS (review and correct):\n${draftNdjson}`;
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

NEVER create a bounded context whose name contains: ${CONTEXT_NAME_GENERATION_BANS.join(", ")}.
Split contexts ONLY if they have distinct ubiquitous languages and communicate via defined ports. Use ambiguities provided as hints to flag uncertain contexts.
Do NOT accept more than ${DEFAULT_MAX_BOUNDED_CONTEXTS} bounded contexts. If you find more candidates, promote the strongest and mark the rest as uncertain.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"status": "accepted", "name": "climate-control", "contextType": "core", "reasoning": "Owns the climate policy invariants.", "responsibility": "Manage climate policy lifecycle and compliance rules.", "aggregateRoots": ["ClimatePolicy"], "useCaseNames": ["Create Policy", "Evaluate Policy"], "eventsPublished": ["PolicyCreated", "PolicyEvaluated"]}
{"status": "rejected", "name": "postgres-adapter", "reasoning": "PostgreSQL is infrastructure, not a bounded context."}
{"status": "uncertain", "name": "drift-analytics", "reasoning": "Could belong to climate-control (drift is a policy deviation) or be its own monitoring context. Ambiguity: unclear if this is a separate service or feature."}

RULES:
- "status" must be "accepted", "rejected", or "uncertain".
- "contextType" is required for "accepted" status (must be: core, supporting, generic, shared-kernel, driver).
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

  return `<original_intent>\n${header}${hintsSection}\n</original_intent>\n<domain_analysis>\n${domainSection}\n</domain_analysis>\n\nClassify Contexts (NDJSON):`;
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

APP-LEVEL METADATA IS NOT A PORT
=================================
The \`apps[]\` array describes RUNTIME HOSTING, not domain dependencies:

- \`apps[].responsibilities\` — what the app process runs (cron jobs,
  integrations, infra duties). These become Stage 4 adapters that wire
  INTO existing context ports. They are NEVER outbound ports themselves.
- \`apps[].deployment\` — the hosting platform (Vercel, Fly.io, AWS).
  A bounded context never "calls Vercel"; deployment is irrelevant to
  the hexagonal model. NEVER emit {Platform}ClientPort.
- \`apps[].schedule\` — a cron expression. Schedules drive worker
  adapters, not context ports.

Rule of thumb: if the name comes from \`apps[].*\`, it is NOT a port.
If you find yourself naming a port after a deployment platform or a
cron-job duty, STOP and re-derive from the context's aggregates,
events_published, and value_objects instead.

PORT JUSTIFICATION
==================
Every port SHOULD include a "justification" field — a 1-2 sentence
explanation of WHY this port exists, tied to a specific domain need,
aggregate dependency, or external-system contract.

BAD: "justification": "Repository for Order"
GOOD: "justification": "Order aggregate requires persistent storage for order state across checkout and fulfillment workflows"

BAD: "justification": "Sends emails"
GOOD: "justification": "Notifies customers of order confirmation and shipping updates via the NotificationDispatcher port contract"

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line. Two NDJSON types:

Port entries:
{"type": "port", "contextName": "climate-control", "direction": "in", "name": "SensorTelemetryPort", "portType": "event", "description": "Receives sensor readings.", "forAggregate": "ClimatePolicy", "justification": "ClimatePolicy aggregate requires real-time sensor data to evaluate policy compliance rules against environmental conditions"}

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

  return `<original_intent>\n${header}${techSection}\n</original_intent>\n<accepted_contexts>\n${contextSection}\n</accepted_contexts>\n<domain_analysis>\n${domainInfo}\n</domain_analysis>\n\nGenerate Ports and Context Mappings (NDJSON):`;
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
Each adapter SHOULD include a "technology" field naming the concrete technology used (e.g. "PostgreSQL", "RabbitMQ", "Axios", "SendGrid", "Express"). Technology choices MUST come from the project's explicit technology stack (provided below). If no explicit technology matches, infer a sensible default.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"adapter": {"contextName": "climate-control", "name": "PostgresClimateRepoAdapter", "adapterType": "Repository", "technology": "PostgreSQL", "implements": "ClimateStateRepository"}}
{"adapter": {"contextName": "climate-control", "name": "MqttSensorListenerAdapter", "adapterType": "Listener", "technology": "MQTT", "implements": "SensorTelemetryPort"}}
{"adapter": {"contextName": "climate-control", "name": "ExpressClimateControllerAdapter", "adapterType": "Controller", "technology": "Express", "implements": "CreateClimatePolicyPort"}}

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

  const explicitTech = [
    ...(normalized?.explicitTechnologies ?? []),
    ...(normalized?.runtimeConcerns ?? []),
  ];
  let techSection = "";
  if (explicitTech.length > 0) {
    techSection = `\n\nEXPLICIT TECHNOLOGIES (use these to inform adapter technology choices):\n${explicitTech.join(", ")}`;
  }

  const infraContext = buildTechnologyContext(variables);
  const infraSection =
    infraContext !== "None specified"
      ? `\n\n<technology_context>\n${infraContext}\n</technology_context>`
      : "";

  return `<original_intent>\n${header}${techSection}\n</original_intent>\n<defined_ports>\n${portsMapStr}\n</defined_ports>\n<accepted_contexts>\n${contextSection}\n</accepted_contexts>\n<context_mappings>\n${mappingSection}\n</context_mappings>\n${infraSection}\n\nAssign Adapters (NDJSON):`;
}

// ==========================================
// STAGE 6: VALIDATION REVIEW
// ==========================================
export const STAGE6_VALIDATION_SYSTEM_PROMPT = `You are an adversarial architectural linter for hexagonal DDD manifests.
Your job is to FIND PROBLEMS, not to confirm correctness. Assume there are errors until you have verified otherwise.

SEVERITY LEVELS:
"error"   — structural violation that will cause runtime failure or fundamental DDD misuse. The manifest must be rejected.
"warning" — design smell or missing best practice. The manifest can proceed but should be reviewed by a human.
"info"    — notable observation that does not block generation. Surfaces facts the user should know.

VALIDATION RULES — check every rule explicitly. Do not skip any.

STRUCTURAL RULES (emit "error" if violated):
R01: RESERVED — enforced deterministically by the pipeline, NOT by you.
      Context names containing technology nouns are detected by a deterministic
      check before this review runs. NEVER emit an R01 finding; any R01 line
      you produce is discarded.

R02: Every non-shared-kernel context has at least one inbound port.
      Check: for each context in <port_map> whose context is not a shared kernel, the "in" array must have length >= 1.

R03: Every non-shared-kernel context has at least one outbound repository port.
      Check: for each context in <port_map> whose context is not a shared kernel, the "out" array must contain at least one entry with "type":"repository".

R04: Every outbound port has exactly one adapter assigned.
      Check: for each port in the "out" arrays of <port_map>, exactly one adapter in <adapter_bindings> must name it in "implements".

R05: Every inbound port has exactly one adapter assigned.
      Check: for each port in the "in" arrays of <port_map>, exactly one adapter in <adapter_bindings> must name it in "implements".

R06: No adapter's "implements" value references a port that belongs to a different context.
      Check: for each adapter in <adapter_bindings>, the port named by "implements" must appear in the SAME context's entry in <port_map>.

R07: Every dependsOn reference points to an existing context name.
      Check: for each entry in dependsOn arrays, the referenced name must appear in boundedContexts[*].name.

R08: The manifest has a workspace entry with non-empty name and non-empty description.
      Check: workspace.name and workspace.description must both be non-empty strings.

R09: shared-kernel contexts have no ports.
      Check: for each context where type == "shared-kernel", ports.in and ports.out must both be empty.

DESIGN RULES (emit "warning" if violated):
R10: Every non-shared-kernel context with a domain event in its eventsPublished list has an outbound publisher port.
      Check: if a context declares published events and has no port of type "publisher", emit a warning.

R11: Every domain event consumed by a context (inbound event port) must be published by at least one other context.
      Check: for each inbound port of type "event", the event name it receives must appear in another context's published events.

R12: No two contexts share the same adapter name.
      Check: adapter names must be globally unique across all contexts.

R13: Contexts promoted from uncertain (marked with a promotedFromUncertain flag) are present in the manifest.
      Emit: "warning" for each promoted-from-uncertain context, noting it requires human domain expert review.

R14: Assembly warnings from Stage 5 are surfaced.
      For each assembly warning provided, emit it at its original severity level.

SEMANTIC FIDELITY (emit "info"):
R15: The original project intent is reflected in at least one context name or responsibility description.
      If key concepts from the intent appear in no context name and no responsibility field, emit an "info" noting the potential gap.

PORT QUALITY RULES:
R16 [warning]: Port description and justification (if present) must be non-trivial.
      Check: each port's "description" must be longer than 10 characters and must not be a substring of the port name. If the port has a "justification" field, the same rule applies.
R17 [error]: Port forAggregate (when present) must reference a real aggregate root from the manifest's domain analysis.
      Check: for each port with a forAggregate field, that name must appear in the corresponding context's aggregates list. Fabricated aggregate names indicate a hallucinated port.
R18 [error]: Port names must not leak app-level metadata. Two checks:
      (a) name must not match \`/(Client|Adapter|Host|Platform)(Port)?$/i\` when paired with known platform tokens (Vercel, FlyIO, AWS, GCP, Azure, Heroku, Render, Railway, DigitalOcean, Netlify, Cloudflare);
      (b) name must not contain any token present in <runtime_concerns> (worker responsibilities + deployment platforms). This catches names like \`EmailRetryPort\` and \`OverdueInvoiceDetectionPort\` that escape the regex but still leak \`apps[].responsibilities\`.

CRITICAL OUTPUT FORMAT — NDJSON ONLY.
{"type": "error", "rule": "R06", "message": "Adapter 'EmailNotifierAdapter' in context 'billing' implements 'NotificationPort', which belongs to context 'notification-delivery'."}
{"type": "warning", "rule": "R10", "message": "Context 'notification-delivery' publishes 'NotificationSent' but has no publisher port."}
{"type": "info", "rule": "R15", "message": "Intent mentions 'payment processing' but no context name or responsibility references payments."}
{"type": "warning", "rule": "R13", "message": "Context 'drift-analytics' was promoted from uncertain status and requires domain expert review."}
{"type": "error", "rule": "R18", "message": "Port 'VercelClientPort' in context 'document-vault' leaks deployment platform 'Vercel'."}
{"type": "result", "passed": true, "errorCount": 0, "warningCount": 2, "infoCount": 1}

OUTPUT RULES:
- Check every rule R02 through R18. Do not skip any rule even if you believe it is satisfied. (R01 is enforced deterministically by the pipeline — never emit it.)
- Always emit exactly one "result" object as the final line.
- "passed" is true only if errorCount is 0.
- "errorCount" counts objects of type "error".
- "warningCount" counts objects of type "warning".
- "infoCount" counts objects of type "info".
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage6Prompt(
  state: Pick<
    PipelineState,
    "stage0" | "stage2" | "stage3" | "stage4" | "stage5" | "contextMappings"
  >,
): string {
  const yaml = state.stage5?.yaml ?? "";
  const assemblyWarnings = state.stage5?.assemblyWarnings ?? [];
  const promotedContexts = (state.stage2?.uncertain ?? []).map((u) => u.name);
  const contextMappings = state.contextMappings ?? [];
  const normalized = state.stage0;
  const header = normalized ? buildIntentHeader(normalized) : "";

  const warningsSection =
    assemblyWarnings.length > 0
      ? [
          `<assembly_warnings>`,
          assemblyWarnings
            .map(
              (w) =>
                `{"severity": "${w.severity}", "context": "${w.contextName}", "message": "${w.message}"}`,
            )
            .join("\n"),
          `</assembly_warnings>`,
        ].join("\n")
      : "";

  const promotedSection =
    promotedContexts.length > 0
      ? `<promoted_from_uncertain>\n${promotedContexts.join(", ")}\n</promoted_from_uncertain>`
      : "";

  const mappingSection =
    contextMappings.length > 0
      ? [
          `<context_mappings>`,
          contextMappings
            .map(
              (m) =>
                `${m.upstream} → ${m.downstream} (${m.pattern ?? "unspecified"} via ${m.mechanism ?? "unspecified"})`,
            )
            .join("\n"),
          `</context_mappings>`,
        ].join("\n")
      : "";

  const runtimeConcerns = normalized?.runtimeConcerns ?? [];
  const runtimeConcernsSection =
    runtimeConcerns.length > 0
      ? `<runtime_concerns>\n${runtimeConcerns.join(", ")}\n</runtime_concerns>`
      : "";

  // Judge-grounding sections (baseline findings F3): the assembled YAML
  // renders ports/adapters as name-only string lists, so rules R02–R06
  // (port types, "implements" bindings) were uncheckable from the judge's
  // input alone — every verdict on them was confabulated. Feed the judge the
  // structured Stage 3/4 outputs it is told to check.
  const portContexts = state.stage3?.contexts ?? [];
  const portMapSection =
    portContexts.length > 0
      ? [
          `<port_map>`,
          portContexts
            .map((ctx) =>
              JSON.stringify({
                context: ctx.contextName,
                in: ctx.in.map((p) => ({
                  name: p.name,
                  type: p.type,
                  ...(p.forAggregate ? { forAggregate: p.forAggregate } : {}),
                })),
                out: ctx.out.map((p) => ({
                  name: p.name,
                  type: p.type,
                  ...(p.forAggregate ? { forAggregate: p.forAggregate } : {}),
                })),
              }),
            )
            .join("\n"),
          `</port_map>`,
        ].join("\n")
      : "";

  const adapterContexts = state.stage4?.contexts ?? [];
  const adapterBindingsSection =
    adapterContexts.length > 0
      ? [
          `<adapter_bindings>`,
          adapterContexts
            .map((ctx) =>
              JSON.stringify({
                context: ctx.contextName,
                adapters: ctx.adapters.map((a) => ({
                  name: a.name,
                  implements: a.implements,
                })),
              }),
            )
            .join("\n"),
          `</adapter_bindings>`,
        ].join("\n")
      : "";

  return [
    `<original_intent>`,
    header,
    `</original_intent>`,
    ``,
    `<manifest_yaml>`,
    yaml,
    `</manifest_yaml>`,
    ``,
    portMapSection,
    adapterBindingsSection,
    warningsSection,
    promotedSection,
    mappingSection,
    runtimeConcernsSection,
    ``,
    `Run all rules R02–R18. Output NDJSON:`,
  ]
    .filter(Boolean)
    .join("\n");
}
// Retry prompts (Fallback if NDJSON is malformed)
export interface StageRetryContext {
  /** Stage number 0–6 */
  stage: number;
  /** Attempt number (1-based) */
  attempt: number;
  /** Raw output from the failed attempt, truncated to 800 chars */
  failedOutput: string;
  /** Human-readable description of why the output was rejected */
  errorDetail: string;
  /** Original user prompt that produced the failed output */
  originalPrompt: string;
}

export type RetryResult = { kind: "prompt"; content: string };

/**
 * Stage-specific retry hint strings injected into the correction prompt.
 * Each describes the minimum correct output for that stage.
 */
const STAGE_RETRY_HINTS: Record<number, string> = {
  0: `Emit: one "intent" object, zero or one "projectName" object, zero or one "isStructuredConfig" object, zero or more "technology" / "pattern" / "ambiguity" objects. No other object types.`,
  1: `Emit: "subdomain", "aggregateRoot", "entity", "valueObject", "domainEvent", "useCase", "verb", "noun" objects only. Each aggregateRoot must have "subdomain" and "identityFields". Each entity must have "parentAggregate". Each domainEvent must have past-tense "value".`,
  2: `Emit: "accepted", "rejected", or "uncertain" objects only. Every "accepted" must have: name (kebab-case), contextType (core|supporting|generic|shared-kernel|driver), responsibility, aggregateRoots (array), useCaseNames (array), eventsPublished (array), reasoning. Every "uncertain" must have "reasoning".`,
  3: `Emit port and contextMapping objects only. Every port must have: contextName (matching an accepted context), direction (in|out), portType (command|query|event for in; repository|publisher|external-client|notifier for out), name (PascalCase), description, forAggregate. Every contextMapping must have: upstream, downstream, pattern, mechanism, events.`,
  4: `Emit adapter objects only. Every adapter must have: contextName, name (PascalCase ending in Adapter), adapterType (Repository|Listener|Publisher|HttpClient|Notifier|Controller), implements (exact port name), technology.`,
  5: `Stage 5 (Manifest Assembly) is a pure TypeScript function — it does not call the LLM. A failure here indicates a structural mismatch between upstream stages and the assembler. Expected input shape: { stage0: NormalizedPrompt, stage1: DomainAnalysis, stage2: ClassificationResult, stage3: PortMap, stage4: AdapterBindings }. Verify each upstream stage produced valid output before retrying.`,
  6: `Emit validation objects only: "error", "warning", or "info" with "rule" and "message" fields. End with exactly one "result" object containing passed, errorCount, warningCount, infoCount.`,
};

/**
 * Builds a targeted correction prompt for a failed stage output.
 * Includes the specific error, the failed output, and the stage-specific
 * format reminder. This replaces the generic generalNDJSON retry.
 */
export function buildStageRetryPrompt(ctx: StageRetryContext): RetryResult {
  const hint =
    STAGE_RETRY_HINTS[ctx.stage] ??
    "Output only valid NDJSON — one JSON object per line.";
  const truncatedOutput =
    ctx.failedOutput.length > 800
      ? ctx.failedOutput.slice(0, 800) + "\n... [truncated]"
      : ctx.failedOutput;

  const content = [
    `CORRECTION REQUIRED — Attempt ${ctx.attempt} of ${MAX_RETRY_ATTEMPTS}`,
    `Stage: ${ctx.stage}`,
    ``,
    `Your previous output was rejected for this reason:`,
    `<rejection_reason>`,
    ctx.errorDetail,
    `</rejection_reason>`,
    ``,
    `Your previous output was:`,
    `<failed_output>`,
    truncatedOutput,
    `</failed_output>`,
    ``,
    `The original input that produced this output was:`,
    `<original_input>`,
    ctx.originalPrompt.slice(0, 1000),
    `</original_input>`,
    ``,
    `Stage ${ctx.stage} format reminder:`,
    hint,
    ``,
    `Correct ONLY the invalid portions. Do not regenerate correct objects.`,
    `Output corrected NDJSON:`,
  ].join("\n");

  return { kind: "prompt", content };
}

/** @deprecated Use buildStageRetryPrompt instead */
export const RETRY_PROMPTS = {
  generalNDJSON: (attempt: number): RetryResult => ({
    kind: "prompt",
    content: buildStageRetryPrompt({
      stage: -1,
      attempt,
      failedOutput: "(not provided)",
      errorDetail: "Output contained invalid JSON or markdown.",
      originalPrompt: "(not provided)",
    }).content,
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
          type: contextType as BoundedContextType,
          reasoning: contextDescription,
        },
      ],
      rejected: [],
      uncertain: [],
    },
  });
