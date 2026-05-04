/**
 * Prompt templates for generating manifest.yaml using hardened micro-passes.
 */

export interface PromptVariables {
  userDescription: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

export const WORKSPACE_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Output a JSON object with two fields: "name" (kebab-case string) and "description" (one sentence string).
This represents the overall project workspace.

CORRECT output: {"name": "e-commerce-platform", "description": "A modern online shopping system"}

Output:`;

export const CONTEXT_LIST_SYSTEM_PROMPT = `You are a system architect assistant that analyzes descriptions and identifies bounded contexts.

CRITICAL OUTPUT FORMAT - JSON ONLY, NO MARKDOWN OR EXPLANATION:
{
  "contexts": [
    {
      "name": "ContextName",           // REQUIRED: lowercase-kebab-case
      "type": "core",                   // REQUIRED: Must be exactly one of: 'core', 'supporting', 'driver', 'shared-kernel'
      "description": "What this context does"  // REQUIRED: Brief description
    }
  ]
}

VALIDATION RULES:
- The "type" field MUST be one of: 'core', 'supporting', 'driver', 'shared-kernel' - NOT empty, NOT other values
- All property names MUST be in double quotes: "name" NOT name
- All string values MUST be in double quotes: "value" NOT 'value' NOT value
- Always include ALL three fields for each context
- Always close all brackets and braces

SAFETY CHECK BEFORE OUTPUT:
1. Count opening and closing braces { } - they must match
2. Count opening and closing brackets [ ] - they must match
3. Count quotes " " - they must be even number
4. If any count is off, DO NOT output - instead output valid empty structure: {"contexts": []}

EXAMPLE OF CORRECT OUTPUT:
{
  "contexts": [
    {"name": "user-authentication", "type": "core", "description": "Handles user login, registration, and session management"},
    {"name": "payment-processing", "type": "supporting", "description": "Processes payments and invoices"}
  ]
}

EXAMPLE OF INCORRECT OUTPUT (DO NOT USE):
{"name": AuthContext}                   // ❌ Missing quotes on name value
{"name": "Auth", "type": ""}            // ❌ Empty type is invalid
{"name": "Auth", type: "core"}          // ❌ Missing quotes on type property name
{name:"Auth",type:"core"}               // ❌ Missing quotes everywhere

Output JSON only:`;

export const PORTS_LIST_SYSTEM_PROMPT = `You are a ports and adapters architect that identifies interfaces for a bounded context.

CRITICAL OUTPUT FORMAT - STRICT JSON ONLY:
{
  "in": [                    // REQUIRED: Array of inbound ports (use-cases)
    {
      "name": "PortName",   // REQUIRED: PortName port format
      "type": "use-case",   // REQUIRED: Must be exactly "use-case"
      "description": "What this port does"  // REQUIRED: Brief description
    }
  ],
  "out": [                  // REQUIRED: Array of outbound ports (infrastructure)
    {
      "name": "PortName",   // REQUIRED: PortName port format
      "type": "infrastructure",  // REQUIRED: Must be exactly "infrastructure"
      "description": "What this port does"  // REQUIRED: Brief description
    }
  ]
}

VALIDATION RULES:
- BOTH "in" AND "out" arrays MUST be present (even if empty)
- Every port MUST have: "name", "type", "description"
- "type" MUST be exactly "use-case" for inbound, "infrastructure" for outbound
- String values MUST be properly closed with matching quotes
- Descriptions should be 1-2 sentences, COMPLETE (not cut off mid-sentence)

SAFETY CHECK BEFORE OUTPUT:
1. Count opening and closing braces { } - they must match
2. Count opening and closing brackets [ ] - they must match
3. Count quotes " " - they must be even number
4. If any count is off, DO NOT output - instead output valid empty structure: {"in":[],"out":[]}

EXAMPLE OF CORRECT OUTPUT:
{
  "in": [
    {"name": "CreateOrderPort", "type": "use-case", "description": "Creates new orders in the system"},
    {"name": "CancelOrderPort", "type": "use-case", "description": "Cancels existing orders"}
  ],
  "out": [
    {"name": "PaymentGateway", "type": "infrastructure", "description": "Integrates with Stripe payment API"}
  ]
}

EXAMPLE OF INCORRECT OUTPUT (DO NOT USE):
{"in": []}                           // ❌ Missing "out" array
{"in": [{"name": "Port1"}], "out": []}  // ❌ Port missing type and description
{"in": [{"name": "Port1", "type": "use-case", "description": "Does stuff}  // ❌ Unterminated string
{"in": [], "out": [{"name": "Repo", "type": "infrastructure"}]}  // ❌ Port missing description

STRICT RULES:
1. ALWAYS include both "in" and "out" arrays
2. ALWAYS include all three fields per port
3. ALWAYS close strings with matching quotes
4. NEVER cut off descriptions mid-word or mid-sentence

Output JSON only:`;

export const ADAPTERS_LIST_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Output a JSON array of objects representing infrastructure adapters for the given ports.
Each adapter must have exactly 3 fields:
- "name": string (PascalCase ending in Adapter, e.g. "PostgresOrderAdapter")
- "type": string (e.g. "Repository", "Controller", "Gateway")
- "implements": string (the EXACT name of a port from the provided list, e.g. "OrderRepositoryPort")

CRITICAL: The "implements" field must match a port name exactly. Only output adapters for ports provided.

CORRECT output: [{"name": "PostgresOrderAdapter", "type": "Repository", "implements": "OrderRepositoryPort"}, {"name": "OrderControllerAdapter", "type": "Controller", "implements": "CreateOrderPort"}]

INCORRECT output: [{name: "PostgresAdapter", type: "Repo", implements: "OrderPort"}, ...]

Output:`;

function buildBaseContext(variables: PromptVariables): string {
  const platform = variables.platform || "Node.js/TypeScript";
  const deployment = variables.deployment || "Cloud-native";
  let context = `Target Platform: ${platform}\nDeployment: ${deployment}`;
  if (variables.additionalContext)
    context += `\nAdditional Notes: ${variables.additionalContext}`;
  return context;
}

export type RetryResult =
  | { kind: "prompt"; content: string }
  | { kind: "clarify" };

export const RETRY_PROMPTS = {
  workspace: {
    attempt1: (desc: string): RetryResult => ({
      kind: "prompt",
      content: `You must return ONLY a JSON object. No other text. Example: {"name":"app","description":"desc"}. Now return the workspace for:\n${desc}\nOutput:`,
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    attempt2: (desc: string): RetryResult => ({
      kind: "prompt",
      content: `Your previous output was invalid JSON. Return ONLY the workspace JSON object with "name" and "description" fields. Use this exact format: {"name":"kebab-case","description":"one sentence"}\nOutput:`,
    }),
  },
  contextList: {
    attempt1: (desc: string): RetryResult => ({
      kind: "prompt",
      content: `You must return ONLY a JSON array. No other text. Example: [{"name":"orders","type":"core","description":"..."}]. Now return the contexts for:\n${desc}\nOutput:`,
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    attempt2: (desc: string): RetryResult => ({ kind: "clarify" }),
  },
  ports: {
    attempt1: (contextName: string, desc: string): RetryResult => ({
      kind: "prompt",
      content: `You must return ONLY a JSON object. No other text. Example: {"in":[],"out":[]}. Now return ports for bounded context "${contextName}":\n${desc}\nOutput:`,
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    attempt2: (contextName: string, desc: string): RetryResult => ({
      kind: "prompt",
      content: `Your previous output was invalid JSON. Return ONLY the ports JSON for "${contextName}". Use this exact format: {"in":[{"name":"XPort","type":"UseCase","description":"..."}],"out":[]}\nOutput:`,
    }),
  },
  adapters: {
    attempt1: (contextName: string, portNames: string[]): RetryResult => ({
      kind: "prompt",
      content: `You must return ONLY a JSON array. No other text. Example: [{"name":"XAdapter","type":"Repo","implements":"PortName"}]. Implements MUST be one of: ${portNames.join(", ")}. Return adapters for "${contextName}":\nOutput:`,
    }),
    attempt2: (contextName: string, portNames: string[]): RetryResult => ({
      kind: "prompt",
      content: `Your previous output was invalid JSON. Return ONLY the adapters array for "${contextName}". Each adapter must have "name", "type", and "implements" (must be one of: ${portNames.join(", ")}).\nOutput:`,
    }),
  },
};

export function compileWorkspacePrompt(variables: PromptVariables): string {
  return `Project Description:\n${variables.userDescription}\n\nContext:\n${buildBaseContext(variables)}\n\nOutput:`;
}

export function compileContextListPrompt(variables: PromptVariables): string {
  return `Project Description:\n${variables.userDescription}\n\nContext:\n${buildBaseContext(variables)}\n\nOutput:`;
}

export function compilePortsPrompt(
  contextName: string,
  contextDescription: string,
  contextType: string,
): string {
  const typeHints: Record<string, string> = {
    core: "inbound: CreateXPort, GetXPort, UpdateXPort; outbound: XRepositoryPort, XGatewayPort, XQueuePort",
    supporting:
      "inbound: ProcessXPort, ValidateXPort; outbound: NotificationPort, ExternalServicePort",
    driver:
      "inbound: AcceptXPort, ReceiveXPort; outbound: StoragePort, CachePort",
    "shared-kernel": "inbound: QueryXPort; outbound: SharedDataPort",
  };
  const hint = typeHints[contextType] || typeHints["core"];
  return `Bounded Context: "${contextName}" (type: ${contextType})
Description: ${contextDescription}

Think step-by-step:
1. Inbound ports = use cases this context handles (something the user can DO with this context)
2. Outbound ports = infrastructure this context needs (something this context USES)

Examples for ${contextType} contexts:
${hint}

Output:`;
}

export function compileAdaptersPrompt(
  contextName: string,
  portsList: Array<{ name: string }>,
): string {
  const portNames = portsList.map((p) => p.name).join(", ");
  return `Bounded Context: "${contextName}"\nAvailable Ports to implement: ${portNames}\n\nOutput:`;
}
