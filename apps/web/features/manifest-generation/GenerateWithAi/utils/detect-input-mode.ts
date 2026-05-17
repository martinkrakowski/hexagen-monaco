export type InputMode = "description" | "structured-config";

export function detectInputMode(content: string): InputMode {
  if (!content.trim()) return "description";

  try {
    const parsed = maybeParseJson(content) ?? parseLeanYaml(content);
    if (!parsed || typeof parsed !== "object") return "description";

    const obj = parsed as Record<string, unknown>;
    const hasContexts =
      Array.isArray(obj.bounded_contexts) &&
      (obj.bounded_contexts as unknown[]).length > 0;
    const hasUseCases = obj.use_cases !== undefined && obj.use_cases !== null;
    const hasMappings =
      Array.isArray(obj.context_mappings) &&
      (obj.context_mappings as unknown[]).length > 0;

    return hasContexts && hasUseCases && hasMappings
      ? "structured-config"
      : "description";
  } catch {
    return "description";
  }
}

function maybeParseJson(content: string): unknown | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function parseLeanYaml(content: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      result[key] = value === "" ? [] : value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
