import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { createJevDecisionAdvice } from "../../lib/wire.server";

/**
 * The J5b reviewer gate, shared by /api/jev/report and /api/jev/review.
 *
 * The caller is the owner only when `JEV_REVIEWER_SUB` is a non-empty string
 * AND equals the session token's `sub`. `JEV_REVIEWER_SUB` is read the same
 * way wire.server reads it (J5a): from the jev config when the advice port is
 * active, else straight from the env — the two can never disagree because
 * wire.server's `reviewerSub` IS `process.env.JEV_REVIEWER_SUB ?? ""`.
 *
 * ANY failure — missing config, unreadable or absent token, a different sub —
 * is a 404 with body `{"error":"not_found"}`. Never 401 or 403: the route's
 * existence and its authorization rule are both secrets this gate must not
 * confirm to a caller, and middleware (middleware.ts:64-76, 134-153) already
 * owns the session / CSRF answers those codes describe.
 */
export async function requireJevReviewer(
  request: NextRequest,
): Promise<Response | null> {
  let reviewerSub = "";
  try {
    reviewerSub = createJevDecisionAdvice()?.reviewerSub ?? "";
  } catch {
    // A config that cannot even be built is "no reviewer configured".
    reviewerSub = "";
  }
  if (reviewerSub === "") {
    reviewerSub = process.env.JEV_REVIEWER_SUB ?? "";
  }
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

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
