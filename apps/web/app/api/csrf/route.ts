import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME } from "../../../lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * D-H7 token issuance. A GET here mints the double-submit cookie and returns
 * the same value in the body, so a client can attach the header immediately
 * without re-reading `document.cookie`.
 *
 * Deliberately unauthenticated: the token proves "same origin could read the
 * cookie", not "who you are" — binding it to a session would only force an
 * extra round-trip at sign-in for no additional property. And deliberately
 * NOT httpOnly: the page's script must read it to echo it; that readability
 * is the entire mechanism (see lib/csrf.ts).
 *
 * GET is safe and idempotent-enough here: each call rotates the token, which
 * invalidates nothing except older copies of itself in other tabs — those
 * recover through the client helper's refetch-and-retry path.
 */
export async function GET(request: NextRequest) {
  const token = randomBytes(32).toString("hex");
  const response = NextResponse.json({ token });
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const secure =
    forwardedProto === "https" || request.nextUrl.protocol === "https:";
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
  });
  return response;
}
