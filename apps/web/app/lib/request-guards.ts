import { NextRequest, NextResponse } from "next/server";
// rate-limiter lives in apps/web/lib (a peer of the app/ tree), reached the
// same relative way the manifest/generate route reaches it.
import { checkRateLimit } from "../../lib/rate-limiter";

/**
 * Same-origin check for state-changing (mutation) requests — a lightweight CSRF
 * mitigation. A cross-origin browser `fetch`/XHR always carries an `Origin`
 * header the initiating page's script cannot forge or strip, so comparing it to
 * the request's own `Host` rejects requests kicked off from another site.
 *
 * A missing `Origin` is treated as same-origin: server-to-server callers, curl,
 * and CI legitimately omit it, and a browser cannot suppress `Origin` on a
 * genuine cross-origin non-GET request. This is the deliberate best-effort
 * tradeoff of the "same-origin + rate limit" gate (decision D1) — it is not a
 * bulletproof per-request CSRF token.
 *
 * The `Origin` host is accepted when it matches EITHER the received `Host`
 * header OR a server-configured canonical origin (`APP_ORIGIN`, else
 * `NEXTAUTH_URL`). The canonical origin is not client-controllable, so it keeps
 * the check correct even behind a reverse proxy that rewrites `Host` to the
 * upstream loopback address (the prod deploy is a host-level proxy → 127.0.0.1;
 * `NEXTAUTH_URL=https://app.hexagen-monaco.cloud` is already set there). If the
 * proxy DOES forward the original `Host`, that path matches too. When no
 * canonical env is set (e.g. local dev with no proxy), it falls back to the
 * `Host` comparison alone.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    // A malformed Origin cannot be trusted as same-origin.
    return false;
  }

  const allowed = new Set<string>();
  const host = request.headers.get("host");
  if (host) allowed.add(host.toLowerCase());

  const canonical = process.env.APP_ORIGIN ?? process.env.NEXTAUTH_URL;
  if (canonical) {
    try {
      allowed.add(new URL(canonical).host.toLowerCase());
    } catch {
      // Ignore a malformed canonical-origin env value.
    }
  }

  return allowed.has(originHost);
}

export interface GuardMutationOptions {
  /** Max requests per window before a 429 (default 20). */
  maxRequests?: number;
  /** Fixed-window length in ms (default 60_000). */
  windowMs?: number;
}

/**
 * Gate for state-changing API routes. Rejects cross-origin requests with 403,
 * then applies a sliding-window rate limit keyed by client IP (429). Returns a
 * ready-to-send {@link NextResponse} to short-circuit the handler, or `null`
 * when the request may proceed.
 *
 * Usage at the top of a POST handler:
 * ```ts
 * const gate = guardMutation(request);
 * if (gate) return gate;
 * ```
 */
export function guardMutation(
  request: NextRequest,
  options: GuardMutationOptions = {},
): NextResponse | null {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }

  const { maxRequests = 20, windowMs = 60_000 } = options;
  // Namespace the mutation family under its own key so it never shares a budget
  // with the IP-keyed manifest routes or the `chat:`/`extract:` limiters.
  const rate = checkRateLimit(
    request,
    maxRequests,
    windowMs,
    undefined,
    "mutation",
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          // At least 1s: a boundary-millisecond remainder can round to 0, which
          // RFC 9110 treats as "retry immediately" — not what a 429 means.
          "Retry-After": String(
            Math.max(1, Math.ceil((rate.retryAfter ?? windowMs) / 1000)),
          ),
        },
      },
    );
  }

  return null;
}
