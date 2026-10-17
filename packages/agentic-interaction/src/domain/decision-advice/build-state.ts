/**
 * Pure state builder for Jev decision requests (lane J1a). No npm imports.
 *
 * Invariant 3: declared fields only; refuse, never redact. Any secret-shape
 * hit or byte-cap overflow refuses the whole call with `unknown/refused`.
 */

const PER_FIELD_BYTE_CAP = 8 * 1024; // 8 KiB per field
const TOTAL_BYTE_CAP = 32 * 1024; // 32 KiB in total

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-or-[A-Za-z0-9_-]{8,}/, // OpenRouter (checked before the generic `sk-`)
  /sk-[A-Za-z0-9_-]{16,}/, // generic sk- secret shape
  /ghp_[A-Za-z0-9]{20,}/, // GitHub personal access token (classic)
  /github_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained token
  /AKIA[0-9A-Z]{12,}/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM key material
  /xox[bp]-[A-Za-z0-9-]{10,}/, // Slack bot/user token
  /[0-9a-fA-F]{32,}/, // long high-entropy hex
  /[A-Za-z0-9+/]{40,}={0,2}/, // long high-entropy base64
];

export type BuildStateResult =
  | { ok: true; state: string }
  | { ok: false; reason: "refused" };

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function containsSecretShape(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Build the flattened state text from the declared fields.
 *
 * - Each field (name + value) is capped at 8 KiB, measured with `TextEncoder`.
 * - The total state is capped at 32 KiB.
 * - Any secret-shape hit or overflow refuses with `unknown/refused`. The text
 *   is never redacted or truncated — today's result stands instead.
 */
export function buildState(
  fields: readonly { name: string; value: string }[],
  hash: string,
): BuildStateResult {
  const lines: string[] = [`hash: ${hash}`];

  for (const field of fields) {
    if (containsSecretShape(field.name) || containsSecretShape(field.value)) {
      return { ok: false, reason: "refused" };
    }
    const line = `${field.name}: ${field.value}`;
    if (byteLength(line) > PER_FIELD_BYTE_CAP) {
      return { ok: false, reason: "refused" };
    }
    lines.push(line);
  }

  const state = lines.join("\n");
  if (byteLength(state) > TOTAL_BYTE_CAP) {
    return { ok: false, reason: "refused" };
  }
  return { ok: true, state };
}