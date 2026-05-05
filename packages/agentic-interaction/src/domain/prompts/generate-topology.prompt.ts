/**
 * Server-side single-shot topology prompt.
 *
 * Used by the MCP server's generateTopology() adapter — generates the full
 * topology (workspace + contexts + ports) in one LLM call. This is distinct
 * from the client-side 4-pass micro-generation pipeline whose prompts live
 * in generate-manifest.prompt.ts.
 */

export interface TopologyPromptVariables {
  userDescription: string;
  validationErrors?: string;
}

export const TOPOLOGY_SYSTEM_PROMPT = `You are a JSON generator. You output ONLY valid JSON, nothing else.
No explanations. No markdown. No code blocks. Raw JSON only.

Return a JSON object matching this shape exactly:

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
- type must be one of: "core", "supporting", "generic", "shared-kernel"
- Context names: lowercase kebab-case with hyphens only (e.g. "order-management", not "OrderManagement")
- Port names: PascalCase ending in "Port" (e.g. "CreateOrderPort")
- Each context needs at least 1 inbound port
- Maximum 5 bounded contexts
- dependsOn is optional
- No adapters in this step — they come later

Output:`;

export function compileTopologyUserPrompt(
  variables: TopologyPromptVariables,
): string {
  let prompt = `Project Description:\n${variables.userDescription}\n\nReturn ONLY valid JSON matching the topology schema. No markdown fences, no explanations.\n\nOutput:`;

  if (variables.validationErrors) {
    prompt += `\n\nPrevious output had these validation errors:\n${variables.validationErrors}\n\nFix these errors and return valid JSON.`;
  }

  return prompt;
}
