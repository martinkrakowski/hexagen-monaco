import { escapeXml } from "./escape-xml";

export interface AdapterPromptVariables {
  validatedPortInventory: string[];
  contextName: string;
  validationErrors?: string;
}

export const ADAPTER_SYSTEM_PROMPT = `You are a hexagonal architecture expert. Given a bounded context with validated ports, suggest infrastructure adapters.

Return ONLY valid JSON — no markdown fences, no explanation text. The JSON must be an array of adapter objects:

[
  {
    "name": "<PascalCaseAdapterName>",
    "type": "<adapter-type>",
    "implements": "<exact-port-name>"
  }
]

Rules:
- The "implements" field MUST be one of the valid port names provided below — use the exact name
- Adapter names: PascalCase ending in "Adapter" (e.g. "PostgresOrderRepositoryAdapter")
- If no adapters make sense for a port, omit it
- Only return adapters for ports that need infrastructure implementation`;

export function compileAdapterUserPrompt(
  variables: AdapterPromptVariables,
): string {
  // contextName originates from the user's spec and validationErrors can echo
  // raw LLM output — escape both. The port list is deliberately NOT escaped:
  // it carries an exact-copy contract ("must be one of these exactly") and
  // both consumers validate `implements` against the RAW names
  // (mcp manifest-generation.adapter `portNames.includes`, client path
  // validate-draft `validPortNames.has`). Escaping a string the model is
  // instructed to reproduce byte-for-byte guarantees a mismatch whenever a
  // name contains &<>"' — normalizePortName does not strip those characters.
  const portList = variables.validatedPortInventory.join(", ");

  let prompt = `Context: "${escapeXml(variables.contextName)}"\n\nValid port names are: [${portList}]. The "implements" field must be one of these exactly.\n\nReturn ONLY a JSON array of adapter objects. No markdown fences, no explanations.`;

  if (variables.validationErrors) {
    prompt += `\n\nPrevious output had these validation errors:\n${escapeXml(variables.validationErrors)}\n\nFix these errors and return valid JSON.`;
  }

  return prompt;
}
