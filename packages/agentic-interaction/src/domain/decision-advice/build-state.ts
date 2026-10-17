/**
 * Pure state builder for Jev decision requests (lane J1a). No npm imports.
 *
 * Invariant 3: declared fields only; refuse, never redact. Any secret-shape
 * hit or byte-cap overflow refuses the whole call with `unknown/refused`.
 */

const PER_FIELD_BYTE_CAP = 8 * 1024; // 8 KiB per field
const TOTAL_BYTE_CAP = 32 * 1024; // 32 KiB in total

const SECRET_PATTERNS: readonly RegExp[] = [
  // The `sk-` shapes carry a left alphanumeric boundary so ordinary
  // kebab-case identifiers like `task-scheduling-service` (…ta**sk-s**cheduling…)
  // are not flagged as secret material.
  /(?<![A-Za-z0-9])sk-or-[A-Za-z0-9_-]{8,}/, // OpenRouter (checked before the generic `sk-`)
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/, // generic sk- secret shape
  /(?<![A-Za-z0-9])sk_live_[A-Za-z0-9]{8,}/, // Stripe live secret key
  /(?<![A-Za-z0-9])sk_test_[A-Za-z0-9]{8,}/, // Stripe test secret key
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/, // Google API key
  /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}/, // npm automation/granular token
  /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{20,}/, // GitHub personal access token (classic)
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained token
  /(?<![A-Za-z0-9])gh[opsur]_[A-Za-z0-9]{20,}/, // GitHub app/refresh tokens
  /(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{8,}/, // GitLab personal access token
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{12,}/, // AWS access key id
  /(?<![A-Za-z0-9])ASIA[0-9A-Z]{16}/, // AWS temporary session access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM key material
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/, // Slack app/bot/user/refresh token
  /[0-9a-fA-F]{32,}/, // long high-entropy hex
  // Long high-entropy base64 — the run must mix a digit, an uppercase and a
  // lowercase letter so CamelCase names and route paths pass untouched.
  /(?=[A-Za-z0-9+/]{0,39}[0-9])(?=[A-Za-z0-9+/]{0,39}[A-Z])(?=[A-Za-z0-9+/]{0,39}[a-z])[A-Za-z0-9+/]{40,}={0,2}/,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, // JWT (header.payload.signature)
];

export type BuildStateResult =
  | { ok: true; state: string; hash: string }
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
  const lines: string[] = [];

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
  // The generation hash is metadata, not state: it rides beside the state so
  // it is never sent to the model as part of the prompt text.
  return { ok: true, state, hash };
}