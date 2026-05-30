import { randomUUID } from "node:crypto";

/**
 * The header carrying each request's correlation id. Defaults to the value
 * chosen at install time; the CORRELATION_ID_HEADER env var (see
 * .env.observability.example) overrides it at runtime.
 */
export const CORRELATION_ID_HEADER =
  process.env.CORRELATION_ID_HEADER ?? "{correlation_header}";

// An incoming correlation id is attacker-controllable: it is echoed back in the
// response header and written to every log line. Only trust values that are
// bounded and use a safe charset; anything else is replaced with a minted id so
// a hostile/buggy client cannot pollute logs or break response-header emission.
const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Return the incoming correlation id when it is well-formed, otherwise mint a
 * fresh one. `getHeader` abstracts over framework header APIs — pass
 * `(name) => req.headers[name]` (Express) or `(name) => request.headers.get(name)`
 * (Next / Fetch).
 */
export function getOrCreateCorrelationId(
  getHeader: (name: string) => string | null | undefined,
): string {
  const existing = getHeader(CORRELATION_ID_HEADER);
  if (typeof existing === "string") {
    const candidate = existing.trim();
    if (
      candidate.length > 0 &&
      candidate.length <= MAX_CORRELATION_ID_LENGTH &&
      SAFE_CORRELATION_ID.test(candidate)
    ) {
      return candidate;
    }
  }
  return randomUUID();
}
