import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * The J5b reviewer gate, shared by /api/jev/report and /api/jev/review.
 *
 * The caller is the owner only when `JEV_REVIEWER_SUB` is a non-empty string
 * AND equals the session token's `sub`. The env is read directly: it is the
 * single source of the reviewer's identity (wire.server's `reviewerSub` is
 * the same read), so an indirection through the advice port would add a
 * second path to the same value and nothing else.
 *
 * ANY failure — no configured sub, unreadable or absent token, a different
 * sub — is a 404 with body `{"error":"not_found"}`. Never 401 or 403: the
 * route's existence and its authorization rule are both secrets this gate
 * must not confirm to a caller, and middleware (middleware.ts:64-76, 134-153)
 * already owns the session / CSRF answers those codes describe.
 */
export async function requireJevReviewer(
  request: NextRequest,
): Promise<Response | null> {
  const reviewerSub = process.env.JEV_REVIEWER_SUB ?? "";
  if (typeof reviewerSub !== "string" || reviewerSub === "") {
    return notFound();
  }

  // Same read as the spec route (J5a2): a token that cannot be read is
  // "not the reviewer", never an error surfaced to the caller.
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  }).catch(() => null);
  if (token?.sub !== reviewerSub) return notFound();

  return null;
}

/** The gate's (and the review route's) answer for anything it must not confirm. */
export function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
