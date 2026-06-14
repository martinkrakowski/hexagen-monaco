import { NextResponse, type NextRequest } from "next/server";
import { resolveAnonSession } from "../../../../lib/anon-session";
import { getQuotaStore, fullQuotaSnapshot } from "../../../../lib/quota-store";
import { logger } from "../../../../lib/structured-logger";

// Reads SQLite (better-sqlite3) — must run on the Node runtime, not edge.
export const runtime = "nodejs";

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
  const headers: Record<string, string> = setCookie
    ? { "Set-Cookie": setCookie }
    : {};

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
