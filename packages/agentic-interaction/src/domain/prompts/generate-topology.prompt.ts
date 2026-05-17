/**
 * Server-side single-shot topology prompt.
 *
 * Used by the MCP server's generateTopology() adapter — generates the full
 * topology (workspace + contexts + ports) in one LLM call. This is distinct
 * from the client-side 4-pass micro-generation pipeline whose prompts live
 * in generate-manifest.prompt.ts.
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
 *    <defined_ports>, <manifest_yaml>, <assembly_warnings>.
 *
 * 4. The ProjectDescriptionValidator.DANGEROUS_PATTERNS list is the
 *    first gate. XML delimiters are the second gate. Together they
 *    provide defence-in-depth against prompt injection.
 *
 * When adding a new compile function, all four rules are mandatory.
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
  let prompt = `Project Description:\n<user_input>\n${variables.userDescription}\n</user_input>\n\nReturn ONLY valid JSON matching the topology schema. No markdown fences, no explanations.\n\nOutput:`;

  if (variables.validationErrors) {
    prompt += `\n\nPrevious output had these validation errors:\n<user_input>${variables.validationErrors}</user_input>\n\nFix these errors and return valid JSON.`;
  }

  return prompt;
}
