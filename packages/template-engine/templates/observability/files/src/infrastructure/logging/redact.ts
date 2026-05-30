/**
 * Field-name fragments whose values are masked in logs. Matched case-insensitively
 * as substrings, so "apiKey", "AUTHORIZATION", and "user_password" all redact.
 */
export const REDACTED_FIELDS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
];

const MASK = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_FIELDS.some((fragment) => lower.includes(fragment));
}

/**
 * Recursively copy `value`, masking the value of any key that looks sensitive.
 * Never mutates the input. Use before logging anything that may carry secrets.
 *
 * Cyclic references are replaced with `"[CIRCULAR]"` so logging an object with
 * back-references (common with framework/ORM/request objects) can never cause
 * unbounded recursion. The `seen` set tracks only the current ancestor chain
 * (entries are removed on the way back up), so a value shared across sibling
 * branches without a cycle is still fully redacted.
 */
export function redact(value: unknown): unknown {
  return redactInternal(value, new WeakSet<object>());
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out = value.map((item) => redactInternal(item, seen));
    seen.delete(value);
    return out;
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitive(key) ? MASK : redactInternal(child, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}
