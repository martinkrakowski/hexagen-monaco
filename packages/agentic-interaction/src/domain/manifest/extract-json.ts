import { balanceJSON } from "./json-balancer.js";
import { repairJSON, extractFirstJSONBlock } from "./json-repair.js";

export { balanceJSON } from "./json-balancer.js";
export { repairJSON } from "./json-repair.js";

export function extractJSON(raw: string): string {
  // Try to extract fenced code block first
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Check if it looks like NDJSON (multiple JSON objects, one per line)
  const trimmed = raw.trim();
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 1) {
    // Check if multiple lines start with { or [
    const jsonLikeLines = lines.filter(l => l.match(/^[{[]/));
    if (jsonLikeLines.length > 1) {
      // Likely NDJSON - return as-is for line-by-line parsing
      return trimmed;
    }
  }

  // Single JSON object/array extraction
  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start !== -1 && end !== -1 && end > start)
    return raw.slice(start, end + 1);

  return raw.trim();
}

export function extractArrayFromWrapper<T>(
  data: unknown,
  knownKeys: string[] = ["contexts", "data", "items", "results", "list"],
): T[] {
  if (Array.isArray(data)) return data as T[];

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of knownKeys) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) return value as T[];
    }
  }

  return [];
}

export function extractObjectFromWrapper<T extends Record<string, unknown>>(
  data: unknown,
  _knownKeys: string[] = ["ports", "data", "result"], // eslint-disable-line @typescript-eslint/no-unused-vars
): T | null {
  if (typeof data === "object" && data !== null && !Array.isArray(data))
    return data as T;

  if (Array.isArray(data) && data.length === 1 && typeof data[0] === "object")
    return data[0] as T;

  return null;
}

export function parseJSON<T>(
  raw: string,
):
  | { ok: true; data: T; repairApplied: boolean }
  | { ok: false; error: string; repairApplied: boolean } {
  const jsonStr = extractJSON(raw);
  try {
    const data = JSON.parse(jsonStr) as T;
    return { ok: true, data, repairApplied: false };
  } catch {
    try {
      const repaired = repairJSON(jsonStr);
      if (repaired !== null) {
        const data = JSON.parse(repaired) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // fall through
    }
    try {
      const extracted = extractFirstJSONBlock(jsonStr);
      if (extracted) {
        const data = JSON.parse(extracted) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // fall through
    }
    try {
      const extracted = extractFirstJSONBlock(jsonStr);
      if (extracted) {
        const repaired = repairJSON(extracted);
        if (repaired !== null) {
          const data = JSON.parse(repaired) as T;
          return { ok: true, data, repairApplied: true };
        }
      }
    } catch {
      // fall through
    }
    try {
      const repaired = repairJSON(raw);
      if (repaired !== null) {
        const data = JSON.parse(repaired) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // fall through
    }
    try {
      const startIdx = jsonStr.search(/[{[]/);
      if (startIdx !== -1) {
        const subset = jsonStr.slice(startIdx);
        const balanced = balanceJSON(subset);
        const data = JSON.parse(balanced) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // all fallbacks failed
    }
    try {
      let stripped = jsonStr;
      stripped = stripped.replace(/\/\/[^\n]*/g, "");
      stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
      stripped = stripped.replace(/,\s*([}\]])/g, "$1");
      stripped = stripped.trim();
      if (stripped !== jsonStr) {
        const data = JSON.parse(stripped) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // fall through
    }
    try {
      let stripped = jsonStr;
      stripped = stripped.replace(/\/\/[^\n]*/g, "");
      stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
      stripped = stripped.replace(/,\s*([}\]])/g, "$1");
      const repaired = repairJSON(stripped);
      if (repaired !== null) {
        const data = JSON.parse(repaired) as T;
        return { ok: true, data, repairApplied: true };
      }
    } catch {
      // all fallbacks failed
    }
    return {
      ok: false,
      error: `JSON parse error: unable to parse or repair LLM output`,
      repairApplied: false,
    };
  }
}
