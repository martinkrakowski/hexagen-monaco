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

export const CONTEXT_LIST_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Output a JSON array of objects. Each object represents a bounded context and must have:
- "name": string (kebab-case)
- "type": "core" | "supporting" | "driver" | "shared-kernel"
- "description": string (brief summary)

Maximum 5 contexts. Minimum 1.
Context names: lowercase kebab-case with hyphens only (e.g. "order-management", not "OrderManagement").

CORRECT output: [{"name": "content-management", "type": "core", "description": "Manages articles"}]

Output:`;

export const PORTS_LIST_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Output a JSON object with two arrays: "in" and "out". These represent the ports for a specific bounded context.
- "in": array of objects with "name" (PascalCase ending in Port), "type" (string), "description" (string)
- "out": array of objects with "name" (PascalCase ending in Port), "type" (string), "description" (string)

Each context must have at least 1 inbound port.

CORRECT output: {"in": [{"name": "CreateOrderPort", "type": "UseCase", "description": "Creates an order"}], "out": []}

Output:`;

export const ADAPTERS_LIST_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Output a JSON array of objects representing infrastructure adapters for the given ports.
Each adapter must have:
- "name": string (PascalCase ending in Adapter)
- "type": string (e.g. "Repository", "Controller")
- "implements": string (the exact name of a port from the provided list)

CORRECT output: [{"name": "PostgresOrderAdapter", "type": "Repository", "implements": "OrderRepositoryPort"}]

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
): string {
  return `Bounded Context: "${contextName}"\nDescription: ${contextDescription}\n\nOutput:`;
}

export function compileAdaptersPrompt(
  contextName: string,
  portsList: Array<{ name: string }>,
): string {
  const portNames = portsList.map((p) => p.name).join(", ");
  return `Bounded Context: "${contextName}"\nAvailable Ports to implement: ${portNames}\n\nOutput:`;
}
