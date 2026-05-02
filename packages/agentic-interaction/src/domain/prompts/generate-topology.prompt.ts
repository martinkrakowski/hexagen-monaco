export interface TopologyPromptVariables {
  userDescription: string;
  validationErrors?: string;
}

export const TOPOLOGY_SYSTEM_PROMPT = `You are a DDD and hexagonal architecture expert. Your task is to analyze a project description and identify bounded contexts and their ports.

Return ONLY valid JSON — no markdown fences, no explanation text. The JSON must match this shape exactly:

{
  "workspace": {
    "name": "<project-name>",
    "description": "<brief-description>"
  },
  "boundedContexts": [
    {
      "name": "<kebab-case-context-name>",
      "type": "core",
      "description": "<context-description>",
      "ports": {
        "in": [
          { "name": "<PascalCasePortName>", "type": "<port-type>", "description": "<desc>" }
        ],
        "out": [
          { "name": "<PascalCasePortName>", "type": "<port-type>", "description": "<desc>" }
        ]
      },
      "dependsOn": ["<other-context-name>"]
    }
  ]
}

Rules:
- type must be one of: "core", "supporting", "driver", "shared-kernel"
- Context names: kebab-case (e.g. "order-management")
- Port names: PascalCase ending in "Port" (e.g. "CreateOrderPort")
- Each context needs at least 1 inbound port
- Maximum 10 bounded contexts
- dependsOn is optional
- No adapters in this step — they come later`;

export function compileTopologyUserPrompt(
  variables: TopologyPromptVariables,
): string {
  let prompt = `Project Description:\n${variables.userDescription}\n\nReturn ONLY valid JSON matching the topology schema. No markdown fences, no explanations.`;

  if (variables.validationErrors) {
    prompt += `\n\nPrevious output had these validation errors:\n${variables.validationErrors}\n\nFix these errors and return valid JSON.`;
  }

  return prompt;
}

export const CONTEXT_LIST_SYSTEM_PROMPT = `You are a DDD and hexagonal architecture expert. Identify the bounded contexts for the described system.

Return ONLY a JSON array — no markdown fences, no explanation text. Each element is an object with exactly three fields:
- "name": kebab-case context name (e.g. "order-management")
- "type": one of "core", "supporting", "driver", "shared-kernel"
- "description": one-sentence description of the context's responsibility

Example:
[{"name":"order-management","type":"core","description":"Handles order lifecycle"}]

Rules:
- Maximum 10 contexts
- Each context name must be unique
- No ports or adapters in this step`;

export function compileContextListPrompt(userDescription: string): string {
  return `Project Description:\n${userDescription}\n\nReturn ONLY a JSON array of bounded context objects with name, type, and description. No markdown fences, no explanations.`;
}

export const PORTS_LIST_SYSTEM_PROMPT = `You are a DDD and hexagonal architecture expert. Identify the inbound and outbound ports for a single bounded context.

Return ONLY a JSON object — no markdown fences, no explanation text. The object must have exactly two fields:
- "in": array of inbound port names (PascalCase ending in "Port")
- "out": array of outbound port names (PascalCase ending in "Port")

Example:
{"in":["CreateOrderPort","CancelOrderPort"],"out":["OrderRepositoryPort","EventPublisherPort"]}

Rules:
- Port names: PascalCase ending in "Port" (e.g. "CreateOrderPort")
- Inbound ports represent use cases / entry points into the context
- Outbound ports represent dependencies the context needs from outside
- At least 1 inbound port is required
- No adapters in this step`;

export function compilePortsPrompt(
  contextName: string,
  contextDescription: string,
): string {
  return `Bounded Context: "${contextName}"\nDescription: ${contextDescription}\n\nReturn ONLY a JSON object with "in" and "out" arrays of port names for this context. No markdown fences, no explanations.`;
}
