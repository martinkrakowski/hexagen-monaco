import yaml from "js-yaml";

export type InputMode = "description" | "structured-config" | "semi-structured";

export function detectInputMode(content: string): InputMode {
  if (!content.trim()) return "description";

  try {
    const parsed = maybeParseJson(content) ?? parseLeanYaml(content);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const hasContexts =
        Array.isArray(obj.bounded_contexts) &&
        (obj.bounded_contexts as unknown[]).length > 0;

      if (hasContexts) return "structured-config";
    }
  } catch {
    // Fallthrough
  }

  const hints = [
    /bounded\s*contexts/i,
    /aggregates?/i,
    /value\s*objects?/i,
    /use\s*cases?/i,
    /domain\s*events?/i,
    /context\s*mappings?/i,
    /entities/i,
  ];

  let hintCount = 0;
  for (const hint of hints) {
    if (hint.test(content)) {
      hintCount++;
      if (hintCount >= 2) return "semi-structured";
    }
  }

  return "description";
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
  try {
    const parsed = yaml.load(content) as Record<string, unknown> | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
