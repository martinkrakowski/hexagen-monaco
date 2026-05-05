/**
 * Prompt templates for generating manifest.yaml using the staged pipeline.
 *
 * Compile functions accept typed PipelineState slices rather than raw strings,
 * ensuring the type system catches cross-stage wiring errors.
 */

import type {
  PipelineState,
  NormalizedPrompt,
  DomainAnalysis,
  ClassificationResult,
  PortMap,
  AdapterBindings,
  AssembledManifest,
} from "../value-objects/pipeline-state.js";

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
  if (variables.additionalContext) parts.push(`Additional Notes: ${variables.additionalContext}`);
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
- NO arrays. NO nested objects. NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage0Prompt(state: Pick<PipelineState, never>, variables: PromptVariables): string {
  return `Raw User Description:\n${variables.userDescription}\n\nOutput NDJSON:`;
}

// ==========================================
// STAGE 1: DOMAIN EXTRACTION
// ==========================================
export const STAGE1_DOMAIN_SYSTEM_PROMPT = `You are a domain-driven design expert. Extract pure domain concepts from the normalized intent.
Do NOT output infrastructure, databases, or frameworks. Focus strictly on business verbs and nouns.

CRITICAL OUTPUT FORMAT - NDJSON (Newline-Delimited JSON) ONLY.
Emit a series of objects, one per line:
{"type": "verb", "value": "evaluate"}
{"type": "noun", "value": "Policy"}
{"type": "subdomain", "value": "Climate Policy Management"}

RULES:
- Emit zero or more "verb", "noun", and "subdomain" objects.
- Subdomains should group related verbs and nouns.
- NO technology names (e.g., PostgreSQL, MQTT).
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage1Prompt(state: Pick<PipelineState, "stage0">): string {
  const intent = state.stage0?.intent || "";
  const ambiguities = (state.stage0?.ambiguities || []).map((a) => `- ${a}`).join("\n");
  const ambiguitySection = ambiguities ? `\n\nAmbiguities flagged by Stage 0:\n${ambiguities}` : "";
  return `Normalized Intent:\n${intent}${ambiguitySection}\n\nExtract Domain Concepts (NDJSON):`;
}

// ==========================================
// STAGE 2: CONTEXT CLASSIFICATION
// ==========================================
export const STAGE2_CLASSIFICATION_SYSTEM_PROMPT = `You are a software architect classifying bounded contexts.
You will receive subdomains, explicit technologies, and ambiguities.

CRITICAL RULES FOR BOUNDED CONTEXTS:
1. Does it own a business subdomain with its own invariants and language? → Accept it.
2. Is it a cross-cutting concern (errors, IDs)? → Accept as 'shared-kernel'.
3. Is it a technology used to fulfill a port? → REJECT IT.
4. Is it a delivery mechanism (HTTP, MQTT)? → REJECT IT.

NEVER create a bounded context whose name contains: adapter, repository, cache, queue, database, postgres, redis, mongo, rabbit, kafka, mqtt, s3.
Split contexts ONLY if they have distinct ubiquitous languages and communicate via defined ports. Use ambiguities provided as hints to flag uncertain contexts.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"status": "accepted", "name": "climate-control", "contextType": "core", "reasoning": "Owns the climate policy invariants."}
{"status": "rejected", "name": "postgres-adapter", "reasoning": "PostgreSQL is infrastructure, not a bounded context."}
{"status": "uncertain", "name": "drift-analytics", "reasoning": "Ambiguity noted: unclear if this is a separate service or feature."}

RULES:
- "status" must be "accepted", "rejected", or "uncertain".
- "contextType" is required for "accepted" status (must be: core, supporting, generic, shared-kernel).
- "name" must be kebab-case.
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage2Prompt(state: Pick<PipelineState, "stage0" | "stage1">): string {
  const subdomains = state.stage1?.subdomains || [];
  const nouns = state.stage1?.nouns || [];
  const verbs = state.stage1?.verbs || [];
  const domainAnalysis = [...subdomains, ...nouns, ...verbs].join(", ");

  const explicitTech = state.stage0?.explicitTechnologies || [];
  const ambiguities = state.stage0?.ambiguities || [];
  const hints = [...explicitTech, ...ambiguities].join(", ");

  return `Domain Subdomains & Analysis:\n${domainAnalysis}\n\nHints (Technologies & Ambiguities):\n${hints}\n\nClassify Contexts (NDJSON):`;
}

// ==========================================
// STAGE 3: PORT MAPPING
// ==========================================
export const STAGE3_PORTS_SYSTEM_PROMPT = `You are an architect defining ports for accepted bounded contexts.
You MUST ONLY define ports for the exact contexts provided. DO NOT invent new contexts. DO NOT list adapters.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"contextName": "climate-control", "direction": "in", "name": "SensorTelemetryPort", "portType": "event", "description": "Receives sensor readings."}
{"contextName": "climate-control", "direction": "out", "name": "ClimateStateRepository", "portType": "repository", "description": "Saves state."}

RULES:
- "contextName" must strictly match one of the provided accepted contexts.
- "direction" must be "in" or "out".
- "portType" for "in" must be one of: "command" (write operation trigger), "query" (read operation trigger), "event" (external signal receiver).
- "portType" for "out" must be one of: "repository" (data persistence), "publisher" (message/event emission), "external-client" (external HTTP/service call), "notifier" (alert/notification delivery).
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage3Prompt(state: Pick<PipelineState, "stage2">): string {
  const acceptedContexts = (state.stage2?.accepted || [])
    .map((c) => `- ${c.name} (${c.type}): ${c.reasoning}`)
    .join("\n");

  return `ACCEPTED CONTEXTS ONLY:\n${acceptedContexts}\n\nGenerate Ports (NDJSON):`;
}

// ==========================================
// STAGE 4: ADAPTER ASSIGNMENT
// ==========================================
export const STAGE4_ADAPTERS_SYSTEM_PROMPT = `You are an infrastructure architect binding technologies to explicit outbound and inbound ports.
You MUST ONLY map adapters to the exact ports provided. You may use the provided explicit technologies list.

CRITICAL OUTPUT FORMAT - NDJSON ONLY.
Emit objects one per line:
{"contextName": "climate-control", "adapterName": "PostgresClimateRepoAdapter", "adapterType": "Repository", "implements": "ClimateStateRepository"}
{"contextName": "climate-control", "adapterName": "MqttSensorListenerAdapter", "adapterType": "Listener", "implements": "SensorTelemetryPort"}

RULES:
- "contextName" must match exactly.
- "implements" MUST match a provided port name exactly.
- Adapter names should be PascalCase ending in Adapter.
- Use the provided technology list to inform adapter naming (e.g. if PostgreSQL is listed, name repository adapters "Postgres...Adapter").
- NO markdown. ONLY raw JSON objects separated by newlines.
`;

export function compileStage4Prompt(state: Pick<PipelineState, "stage0" | "stage3">, variables: PromptVariables): string {
  const portMap = state.stage3?.contexts || [];
  let portsMapStr = "";
  for (const ctx of portMap) {
    portsMapStr += `\nContext: ${ctx.contextName}\n`;
    if (ctx.in.length > 0) {
      portsMapStr += ` Inbound:\n`;
      ctx.in.forEach((p) => {
        portsMapStr += `  - ${p.name} (${p.type}): ${p.description}\n`;
      });
    }
    if (ctx.out.length > 0) {
      portsMapStr += ` Outbound:\n`;
      ctx.out.forEach((p) => {
        portsMapStr += `  - ${p.name} (${p.type}): ${p.description}\n`;
      });
    }
  }

  const explicitTech = state.stage0?.explicitTechnologies || [];
  const techStr = explicitTech.length > 0 ? explicitTech.join(", ") : "None specified";
  const infraContext = buildTechnologyContext(variables);

  return `DEFINED PORTS:\n${portsMapStr}\nAVAILABLE EXPLICIT TECHNOLOGIES:\n${techStr}\n\nINFRASTRUCTURE CONTEXT:\n${infraContext}\n\nAssign Adapters (NDJSON):`;
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

export function compileStage6Prompt(state: Pick<PipelineState, "stage5">): string {
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
    stage0: { intent: variables.userDescription, explicitTechnologies: [], explicitPatterns: [], ambiguities: [] },
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
      accepted: [{ name: contextName, type: contextType as "core" | "supporting" | "generic" | "shared-kernel", reasoning: contextDescription }],
      rejected: [],
      uncertain: [],
    },
  });
