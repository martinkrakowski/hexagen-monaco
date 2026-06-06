import yaml from "js-yaml";
import { sanitizePseudoYaml } from "@hexagen/agentic-interaction";

export type InputMode = "description" | "structured-config" | "semi-structured";

export function detectInputMode(content: string): InputMode {
  if (!content.trim()) return "description";

  try {
    let parsed =
      maybeParseJson(content) ??
      parseLeanYaml(content) ??
      parseMultiDocYaml(content);
    if (!parsed) {
      // Recovery: "pseudo-YAML" specs (TypeScript method signatures, quoted
      // union types) fail a strict parse. Quote those scalars and retry so a
      // well-structured spec still routes to the deterministic structured-config
      // path instead of the lossy LLM conversion fallback.
      const sanitized = sanitizePseudoYaml(content);
      if (sanitized !== content) {
        parsed = parseLeanYaml(sanitized) ?? parseMultiDocYaml(sanitized);
      }
    }
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Parse multi-document YAML (visual `---` separators) and merge the
 * resulting documents. Returns null if any doc is not an object or if two
 * docs declare the same top-level key with conflicting values.
 */
function parseMultiDocYaml(content: string): Record<string, unknown> | null {
  let docs: unknown[];
  try {
    docs = yaml.loadAll(content);
  } catch {
    return null;
  }
  const objectDocs = docs.filter(
    (d): d is Record<string, unknown> =>
      d !== null && typeof d === "object" && !Array.isArray(d),
  );
  if (objectDocs.length === 0) return null;

  const merged: Record<string, unknown> = {};
  for (const doc of objectDocs) {
    for (const [key, value] of Object.entries(doc)) {
      if (
        key in merged &&
        JSON.stringify(merged[key]) !== JSON.stringify(value)
      ) {
        return null;
      }
      merged[key] = value;
    }
  }
  return merged;
}
