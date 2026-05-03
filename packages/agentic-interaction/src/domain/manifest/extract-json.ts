export function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start !== -1 && end !== -1 && end > start)
    return raw.slice(start, end + 1);

  return raw.trim();
}

export function repairJSON(raw: string): string | null {
  let s = raw.trim();

  // 1. Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");

  // 2. Remove control characters
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]/g, (c) =>
    c === "\n" || c === "\r" || c === "\t" ? c : "",
  );

  // 3. Truncate to last complete JSON structure (skip braces inside strings)
  let depth = 0;
  let lastValidClose = -1;
  let started = false;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") {
      depth++;
      started = true;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (started && depth === 0) lastValidClose = i;
    }
  }

  const startIdx = s.search(/[{[]/);
  if (startIdx !== -1 && lastValidClose > 0 && lastValidClose >= startIdx) {
    s = s.slice(startIdx, lastValidClose + 1);
  } else if (startIdx !== -1) {
    s = s.slice(startIdx);
  }

  // 4. Try parse
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
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
  } catch (e) {
    const repaired = repairJSON(raw);
    if (repaired !== null) {
      try {
        const data = JSON.parse(repaired) as T;
        return { ok: true, data, repairApplied: true };
      } catch {
        // Ignore repair parse error and fall through
      }
    }
    const message = e instanceof Error ? e.message : "Invalid JSON";
    return {
      ok: false,
      error: `JSON parse error: ${message}`,
      repairApplied: repaired !== null,
    };
  }
}
