export function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start !== -1 && end !== -1 && end > start)
    return raw.slice(start, end + 1);

  return raw.trim();
}

export function parseJSON<T>(
  raw: string,
): { ok: true; data: T } | { ok: false; error: string } {
  const jsonStr = extractJSON(raw);
  try {
    const data = JSON.parse(jsonStr) as T;
    return { ok: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    return { ok: false, error: `JSON parse error: ${message}` };
  }
}
