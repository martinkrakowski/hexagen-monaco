import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

/**
 * Cookie that identifies an anonymous free-tier visitor for daily-quota
 * accounting. Server-issued + HttpOnly — the client never reads or sets it.
 * Clearing/stripping it just mints a fresh session, which is why the per-IP
 * limiter (`lib/rate-limiter.ts`) stays on as the abuse backstop.
 */
export const ANON_SESSION_COOKIE = "hxg_sid";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface AnonSession {
  sessionId: string;
  /** `Set-Cookie` value to attach to the response — present only when a new
   * session was just minted (the request arrived without one). */
  setCookie?: string;
}

// We only ever mint randomUUID() values, so a cookie that isn't UUID-shaped is
// either absent or attacker-supplied. Rejecting it (the anchored regex also caps
// length) bounds session_id — a quota_usage primary-key component — to 36 chars,
// closing a cookie-driven DB-bloat vector (oversized / high-cardinality values).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the anonymous session from the request, minting (and returning a
 * `Set-Cookie` for) a new one when absent or malformed. */
export function resolveAnonSession(request: NextRequest): AnonSession {
  const existing = request.cookies.get(ANON_SESSION_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return { sessionId: existing };

  const sessionId = randomUUID();
  const attrs = [
    `${ANON_SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    `Max-Age=${ONE_YEAR_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return { sessionId, setCookie: attrs.join("; ") };
}
