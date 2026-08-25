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
 *
 * AMENDMENT — 2026-08-25 (D-H7). D1's "best-effort, not a per-request CSRF
 * token" stance is now SUPPLEMENTED, not replaced: H1 has shipped (orgs,
 * teams, project shares), which is exactly the blast-radius trigger the
 * 2026-08-20 hosting plan's D-H7 gate named for adopting double-submit.
 * Every mutation under /api (NextAuth's /api/auth surface and the /api/csrf
 * issuance route excepted) now ALSO requires an `x-hexagen-csrf` header
 * matching the `hexagen-csrf` cookie WHENEVER the request carries a NextAuth
 * session cookie — enforced in ONE place, `apps/web/middleware.ts`
 * (`guardApiCsrf`), with token issuance at GET /api/csrf and the
 * constant-time comparison in `apps/web/lib/csrf.ts`. Cookie-less callers
 * (the wedge, CI, curl, the anonymous quota flows) never meet that check.
 * THIS origin check stays as written and keeps covering every anonymous
 * mutation, where there is no session cookie for double-submit to bind to.
 * The original D1 text above is preserved deliberately — a decision record
 * that silently changes is the anti-pattern this repo documents.
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

/** Narrow an `unknown` (e.g. a decoded JSON body) to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode a request's JSON body, turning a PARSE failure into a 400 instead of
 * letting it reject into the handler's outer `catch` (which maps every throw to
 * a 500). `request.json()` rejects on a malformed / truncated / empty body —
 * that is a client error and belongs in the 4xx class alongside the shape
 * ({@link guardManifestBody}) and size ({@link guardManifestSize}) guards below,
 * not a 500. Returns the decoded body (typed `unknown` — validate its shape with
 * `guardManifestBody`) on success, or a ready-to-send 400 on parse failure.
 *
 * Usage as the first step of a POST handler:
 * ```ts
 * const parsed = await readJsonBody(request);
 * if (!parsed.ok) return parsed.response;
 * const body = parsed.body; // unknown — hand to guardManifestBody next
 * ```
 */
export async function readJsonBody(
  request: Request,
): Promise<
  { ok: true; body: unknown } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      ),
    };
  }
}

/**
 * Validate a decoded governance request body before the route trusts its
 * `as ...RequestBody` cast. The cast is a compile-time fiction: a `null` JSON
 * body makes `body.manifestYaml` throw (→ a 500 from the outer catch), and an
 * object-valued `manifestYaml` slips past {@link guardManifestSize} (its
 * `.length` is `undefined`, so `undefined > MAX` is `false`) and reaches YAML
 * parse / shell-lint / the LLM. Rejects any body that is not a plain object with
 * a non-empty string `manifestYaml` with a 400, or returns `null` to proceed.
 */
export function guardManifestBody(body: unknown): NextResponse | null {
  if (
    !isRecord(body) ||
    typeof body.manifestYaml !== "string" ||
    body.manifestYaml.length === 0
  ) {
    return NextResponse.json(
      { error: "manifestYaml is required" },
      { status: 400 },
    );
  }
  return null;
}

/**
 * Maximum accepted size of the optional `openFileContent` field, in characters.
 * The `suggestions` and `refresh` routes append it verbatim to the LLM prompt,
 * so — like {@link MAX_MANIFEST_YAML_CHARS} — it needs its own bound, or a large
 * open-file payload re-opens the exact LLM-resource surface the manifest guard
 * closes.
 */
export const MAX_OPEN_FILE_CONTENT_CHARS = 200_000;

/**
 * Bound the optional `openFileContent` before it is appended to the suggestion
 * LLM prompt. Absent (`undefined`/`null`) is fine — the field is optional. A
 * present non-string is rejected (the `as` cast does not enforce it, and a
 * `[object Object]` must not reach the prompt); an over-large string is rejected
 * with a 400. Returns `null` to proceed.
 */
export function guardOpenFileContentSize(
  openFileContent: unknown,
): NextResponse | null {
  if (openFileContent === undefined || openFileContent === null) return null;
  if (typeof openFileContent !== "string") {
    return NextResponse.json(
      { error: "openFileContent must be a string" },
      { status: 400 },
    );
  }
  if (openFileContent.length > MAX_OPEN_FILE_CONTENT_CHARS) {
    return NextResponse.json(
      {
        error: `Open file is too large (exceeds ${MAX_OPEN_FILE_CONTENT_CHARS.toLocaleString()} characters).`,
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
  /** Rate-limit namespace so families do not share one budget. */
  keyPrefix?: string;
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

  const {
    maxRequests = 20,
    windowMs = 60_000,
    keyPrefix = "mutation",
  } = options;
  // Namespace the mutation family under its own key so it never shares a budget
  // with the IP-keyed manifest routes or the `chat:`/`extract:` limiters.
  const rate = checkRateLimit(
    request,
    maxRequests,
    windowMs,
    undefined,
    keyPrefix,
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
