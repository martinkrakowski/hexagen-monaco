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
 * The comparison is on the full origin — scheme + host + port — not host alone:
 * a bare host match would treat `http://<host>` and `https://<host>` as the
 * same origin and let a scheme-downgraded cross-origin POST through (CWE-352).
 * The `Origin` is accepted when its `URL.origin` matches EITHER the request's
 * own effective origin (its `Host` combined with a TRUSTED scheme — the
 * `x-forwarded-proto` our reverse proxy sets, else the request URL's own
 * protocol) OR a server-configured canonical origin (`APP_ORIGIN`, else
 * `NEXTAUTH_URL`). The canonical origin is not client-controllable, so it keeps
 * the check correct even behind a reverse proxy that rewrites `Host` to the
 * upstream loopback address (the prod deploy is a host-level proxy → 127.0.0.1;
 * `NEXTAUTH_URL=https://app.hexagen-monaco.cloud` is already set there). If the
 * proxy DOES forward the original `Host`, that path matches too. When no
 * canonical env is set (e.g. local dev with no proxy), the request's own
 * effective origin is the sole allowed origin.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originValue: string;
  try {
    // Compare on the full origin (scheme://host:port), not the host alone.
    originValue = new URL(origin).origin;
  } catch {
    // A malformed Origin cannot be trusted as same-origin.
    return false;
  }

  const allowed = new Set<string>();

  // The request's OWN effective origin: its `Host` paired with a trusted scheme.
  // The scheme comes from `x-forwarded-proto` (set by our reverse proxy, which
  // overwrites any client-supplied value) and falls back to the request URL's
  // protocol for direct/local connections. A multi-hop proxy chain yields
  // "https, http" — the client-facing scheme is the first entry.
  const host = request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    const scheme =
      forwardedProto || new URL(request.url).protocol.replace(/:$/, "");
    // Only bare http/https are valid web-origin schemes. Guarding here stops a
    // malformed `x-forwarded-proto` (e.g. one containing "://") from being
    // interpolated into the origin string and collapsing it to a foreign origin
    // that would then be whitelisted. A rejected scheme drops the own-origin
    // path entirely; the canonical origin below still carries legitimate prod
    // traffic.
    if (scheme === "http" || scheme === "https") {
      try {
        allowed.add(new URL(`${scheme}://${host}`).origin);
      } catch {
        // Ignore an unparseable Host value.
      }
    }
  }

  // A server-configured canonical origin (not client-controllable) survives a
  // proxy that rewrites `Host` to the upstream loopback. APP_ORIGIN wins.
  const canonical = process.env.APP_ORIGIN ?? process.env.NEXTAUTH_URL;
  if (canonical) {
    try {
      allowed.add(new URL(canonical).origin);
    } catch {
      // Ignore a malformed canonical-origin env value.
    }
  }

  return allowed.has(originValue);
}

/**
 * Maximum accepted size of a client-supplied manifest YAML, in characters.
 *
 * The governance POST routes hand this string straight to a synchronous
 * `yaml.load` (and, in `refresh`, on to a `yarn lint:arch` shell-out and an LLM
 * call). js-yaml 4.x applies no size, depth, or alias limit of its own, so an
 * unbounded body is a cheap way to burn server CPU/memory before any of that
 * work is even known to be wanted. Bounding the raw input up front caps that
 * surface. Measured in characters (not UTF-8 bytes) to match the repo's
 * established `MAX_TRANSCRIPT_CHARS` / `MAX_LOOSE_SPEC_INPUT_CHARS` caps — for a
 * "reject the runaway payload" guard the two bound the parse equivalently.
 */
export const MAX_MANIFEST_YAML_CHARS = 200_000;

/**
 * Reject an over-large manifest before it reaches `yaml.load` / the linter /
 * the LLM. Returns a ready-to-send 400 {@link NextResponse}, or `null` when the
 * manifest is within {@link MAX_MANIFEST_YAML_CHARS}.
 *
 * Applied per-route at each governance POST handler rather than inside
 * `analyzeManifest`, because `suggestions` and `refresh`'s lint/LLM paths
 * consume the raw manifest WITHOUT going through the analyzer — an analyzer-only
 * guard would leave those paths unbounded.
 *
 * Usage right after the presence check:
 * ```ts
 * const tooLarge = guardManifestSize(body.manifestYaml);
 * if (tooLarge) return tooLarge;
 * ```
 */
export function guardManifestSize(manifestYaml: string): NextResponse | null {
  if (manifestYaml.length > MAX_MANIFEST_YAML_CHARS) {
    return NextResponse.json(
      {
        error: `Manifest is too large (exceeds ${MAX_MANIFEST_YAML_CHARS.toLocaleString()} characters).`,
      },
      { status: 400 },
    );
  }
  return null;
}

export interface GuardMutationOptions {
  /** Max requests per window before a 429 (default 20). */
  maxRequests?: number;
  /** Fixed-window length in ms (default 60_000). */
  windowMs?: number;
}

/**
 * Gate for state-changing API routes. Rejects cross-origin requests with 403,
 * then applies a fixed-window rate limit keyed by client IP (429). Returns a
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
