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

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_FIELDS.some((fragment) => lower.includes(fragment));
}

/**
 * Recursively copy `value`, masking the value of any key that looks sensitive.
 * Never mutates the input. Use before logging anything that may carry secrets.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitive(key) ? MASK : redact(child);
    }
    return out;
  }
  return value;
}
