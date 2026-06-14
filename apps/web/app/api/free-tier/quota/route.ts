import { NextResponse, type NextRequest } from "next/server";
import { resolveAnonSession } from "../../../../lib/anon-session";
import { getQuotaStore, fullQuotaSnapshot } from "../../../../lib/quota-store";
import { logger } from "../../../../lib/structured-logger";

// Reads SQLite (better-sqlite3) — must run on the Node runtime, not edge.
export const runtime = "nodejs";
// Per-session (varies by hxg_sid) and may mint a cookie — never statically
// optimize or cache it.
export const dynamic = "force-dynamic";

/**
 * GET /api/free-tier/quota
 *
 * The caller's remaining free-tier quota for today, so the badge/modal can show
 * "N generations left" + a reset time. Read-only — it peeks, never consumes.
 * Mints + sets the `hxg_sid` cookie when the caller has none yet, so the very
 * first read establishes the session the generate/chat routes will meter
 * against. Fails open to full quota if the store is unavailable (same posture as
 * enforcement) so the UI never shows a false "0 left".
 */
export async function GET(request: NextRequest) {
  const { sessionId, setCookie } = resolveAnonSession(request);
  // Session-scoped + cookie-minting: forbid shared/proxy caching and vary on the
  // cookie — applied to both the success and fail-open responses below.
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    ...(setCookie ? { "Set-Cookie": setCookie } : {}),
  };

  try {
    return NextResponse.json(getQuotaStore().snapshot(sessionId), { headers });
  } catch (error) {
    logger.warn(
      "[quota] status read failed — reporting full quota (fail-open)",
      {
        error,
      },
    );
    return NextResponse.json(fullQuotaSnapshot(), { headers });
  }
}
