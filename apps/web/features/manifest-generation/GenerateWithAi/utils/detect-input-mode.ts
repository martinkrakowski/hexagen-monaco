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
    // Prose / heading-style hints
    /\bbounded[_\s-]?contexts?/i,
    /\baggregates?/i,
    /\bvalue[_\s-]?objects?/i,
    /\buse[_\s-]?cases?/i,
    /\bdomain[_\s-]?events?/i,
    /\bcontext[_\s-]?mappings?/i,
    /\bentities\b/i,
    // YAML-structural hints — catch partial / loosely-typed YAML
    /^---\s*$/m, // multi-document separator
    /^\s*-\s+name:/m, // list of named entries
    /^\s*apps?:/m, // top-level apps section
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
