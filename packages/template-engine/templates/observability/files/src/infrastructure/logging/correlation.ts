import { randomUUID } from "node:crypto";

/**
 * The header carrying each request's correlation id. Defaults to the value
 * chosen at install time; the CORRELATION_ID_HEADER env var (see
 * .env.observability.example) overrides it at runtime.
 */
export const CORRELATION_ID_HEADER =
  process.env.CORRELATION_ID_HEADER ?? "{correlation_header}";

/**
 * Return the incoming correlation id, or mint a fresh one. `getHeader` abstracts
 * over framework header APIs — pass `(name) => req.headers[name]` (Express) or
 * `(name) => request.headers.get(name)` (Next / Fetch).
 */
export function getOrCreateCorrelationId(
  getHeader: (name: string) => string | null | undefined,
): string {
  const existing = getHeader(CORRELATION_ID_HEADER);
  if (typeof existing === "string" && existing.trim().length > 0) {
    return existing.trim();
  }
  return randomUUID();
}
