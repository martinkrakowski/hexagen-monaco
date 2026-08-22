import { NextResponse, type NextRequest } from "next/server";
import { resolveAnonSession } from "../../../lib/anon-session";
import {
  getQuotaStore,
  type QuotaResult,
  type QuotaStore,
} from "../../../lib/quota-store";
import { logger } from "../../../lib/structured-logger";

/**
 * Free-tier daily quota for the brownfield scan entry points (F-10, decision
 * D-U1). Nothing metered scans before this.
 *
 * **Quota and rate limit are different concerns, and both apply.** Each scan
 * route already calls `guardMutation` (same-origin + per-IP `checkRateLimit`
 * under its own key prefix), which bounds how FAST one caller may scan. This
 * bounds how MUCH one anonymous session may scan in a day. Neither subsumes the
 * other: the per-IP window resets every 60 seconds, so on its own it permits an
 * unbounded daily total of real server compute (archive unpack, and on the
 * Tier-B path a `hexagen` CLI subprocess with a 60s budget).
 *
 * **Why this is not built on `lib/enforce-quota.ts`.** That module is listed in
 * ADR-0063's "do-not-touch files" and is frozen against metering edits. Its
 * exhaustion copy is also LLM-specific — "…N generations… add your own API key
 * (BYOK) or run a local model" — while scanning invokes no LLM and has no BYOK
 * path, so reusing it would have meant editing a frozen file to keep the message
 * honest. This is the same gate shape with scan's own copy, and it leaves every
 * ADR-0063 file untouched.
 *
 * **This gate FAILS OPEN.** If the quota store cannot be opened or read (the
 * realistic case being the `/data` volume not yet mounted), the scan is allowed
 * rather than 500'd. Deliberate, for two reasons — and the second is why
 * "unbounded free compute" is not the consequence:
 *
 * 1. It matches the posture the rest of the product already documents
 *    (`lib/enforce-quota.ts`, `GET /api/free-tier/quota`), so a store outage
 *    degrades uniformly instead of bricking the brownfield entry flow alone.
 * 2. The fail-open window stays bounded by the per-IP limiter each route
 *    installs (5/min for the CLI scan, 15/min for handoff parse). That limiter
 *    is in-process memory and cannot fail together with the SQLite store.
 *
 * Fail-closed would trade a bounded overspend during an outage for a hard outage
 * of the whole feature; that is the worse failure here.
 */

/**
 * Both scan entry points charge the same kind on purpose. `POST
 * /api/projects/scan` (Tier B, zip upload → CLI) and `POST
 * /api/projects/scan/artifacts` (Tier A, handoff parse) are ALTERNATIVE ways to
 * start one scan — the UI calls one or the other, never both for a single user
 * action — so one shared budget charges one action exactly once.
 */
const SCAN_KIND = "scan" as const;

export interface ScanQuotaGate {
  /**
   * Headers every response from here on must carry. Holds the `Set-Cookie` for a
   * freshly minted anonymous session (and is empty for a returning one). Dropping
   * it would mint a new session per request, and the daily cap — keyed on that
   * cookie — would never accumulate.
   */
  headers: Record<string, string>;
  /**
   * Cheap pre-flight. Returns a ready 429 when today's budget is already spent,
   * else `null`.
   *
   * PEEKS — it never counts, so it cannot double-charge against
   * {@link ScanQuotaGate.charge}. Call it before the request body is read so an
   * exhausted caller is turned away before a multi-megabyte upload is buffered.
   */
  precheck(): NextResponse | null;
  /**
   * Count exactly one scan. Call once, immediately before the expensive work and
   * after every cheap validation has passed, so a malformed upload never burns a
   * credit. Returns a 429 if the budget ran out between `precheck` and here (two
   * concurrent requests on one session), else `null`.
   */
  charge(): NextResponse | null;
  /** Attach {@link ScanQuotaGate.headers} to a finished response and return it. */
  applyHeaders(response: NextResponse): NextResponse;
}

/**
 * Open the scan quota gate for one request. `store` is injectable for tests;
 * routes pass nothing and get the process-wide store.
 */
export function openScanQuota(
  request: NextRequest,
  store?: QuotaStore,
): ScanQuotaGate {
  const { sessionId, setCookie } = resolveAnonSession(request);
  const headers: Record<string, string> = setCookie
    ? { "Set-Cookie": setCookie }
    : {};

  // The outcome of the one permitted `charge()`. `undefined` means "not charged
  // yet"; `null` means "charged, allowed". A second `charge()` replays the first
  // outcome instead of counting again — reaching it twice is a routing bug, and
  // the caller must not pay twice for one scan.
  let charged: NextResponse | null | undefined;

  function resolveStore(): QuotaStore {
    return store ?? getQuotaStore();
  }

  function denial(result: QuotaResult): NextResponse {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    );
    const message =
      `You've reached the free-tier daily limit of ${result.limit} project scans. ` +
      "It resets at midnight UTC — install the hexagen CLI and run " +
      "`hexagen scan` on your own machine to keep going now.";
    // `error` matches the shape both scan routes already use for failures.
    // `kind` is what lets a client tell this 429 apart from `guardMutation`'s
    // per-IP rate-limit 429, which carries no `kind`.
    return NextResponse.json(
      {
        error: message,
        kind: SCAN_KIND,
        limit: result.limit,
        remaining: 0,
        resetAt: result.resetAt,
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  return {
    headers,
    precheck() {
      let result: QuotaResult;
      try {
        result = resolveStore().peek(sessionId, SCAN_KIND);
      } catch (error) {
        // Fail open — see the module note. Never `catch { return null }` as a
        // silent swallow: the outage is logged, and the decision is the comment.
        logger.warn(
          "[quota] scan store unavailable on precheck — allowing (fail-open)",
          { error, kind: SCAN_KIND },
        );
        return null;
      }
      return result.allowed ? null : denial(result);
    },
    charge() {
      if (charged !== undefined) return charged;
      let result: QuotaResult;
      try {
        result = resolveStore().consume(sessionId, SCAN_KIND);
      } catch (error) {
        logger.warn(
          "[quota] scan store unavailable on charge — allowing (fail-open)",
          { error, kind: SCAN_KIND },
        );
        charged = null;
        return charged;
      }
      charged = result.allowed ? null : denial(result);
      return charged;
    },
    applyHeaders(response) {
      for (const [name, value] of Object.entries(headers)) {
        response.headers.set(name, value);
      }
      return response;
    },
  };
}
