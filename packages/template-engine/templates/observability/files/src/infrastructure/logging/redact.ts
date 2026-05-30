// Redaction policy: masking is by field *name* only. An Error's `message` and
// `stack` are logged verbatim (see redactInternal) — they are not scrubbed, so
// they can surface file paths and any secret a caller embedded in an error
// message. Keep secrets out of error construction, and treat logs as sensitive
// at rest. This is a deliberate trade-off: key-redacting stack traces is
// unreliable and destroys their debugging value.

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
  // Preserve Date — the generic object branch sees no enumerable keys and would
  // emit `{}`. Returned as-is so JSON serialization renders it as an ISO string.
  if (value instanceof Date) {
    return value;
  }
  // Error's name/message/stack are non-enumerable, so Object.entries() yields
  // nothing and the object branch would erase the crash details. Extract them
  // explicitly, plus the cause chain and any enumerable own props (redacted).
  if (value instanceof Error) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause = redactInternal(cause, seen);
    }
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitive(key) ? MASK : redactInternal(child, seen);
    }
    seen.delete(value);
    return out;
  }
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
