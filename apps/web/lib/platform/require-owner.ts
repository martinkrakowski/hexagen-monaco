import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/** Persistence writes are chatty (live-session patches). Isolated namespace. */
export const PROJECT_MUTATION_GUARD = {
  maxRequests: 120,
  windowMs: 60_000,
  keyPrefix: "projects",
} as const;

export type OwnerResolution =
  | { ok: true; ownerId: string }
  | { ok: false; response: NextResponse };

/**
 * Persistence APIs require a JWT `sub`. Generate routes stay ungated
 * (quota-D2). Unsigned browsers keep origin-private IDB via the cache adapter.
 */
export async function requirePersistenceOwner(
  request: NextRequest,
): Promise<OwnerResolution> {
  const token = await getToken({ req: request });
  const sub = typeof token?.sub === "string" ? token.sub.trim() : "";
  if (!sub) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "unauthorized",
          message: "Sign in required",
          statusCode: 401,
        },
        { status: 401 },
      ),
    };
  }
  return { ok: true, ownerId: sub };
}
