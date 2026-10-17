import { NextRequest } from "next/server";
import { requireJevReviewer, notFound } from "../reviewer-guard";
import { getPlatformStore } from "../../../../lib/platform";
import {
  isDecisionOwnerReview,
  type DecisionOwnerReview,
} from "../../../../lib/platform/decision-receipts-store";

/**
 * Jev J5b: the owner-review write, behind the reviewer gate.
 *
 * The owner records a closed-set verdict on ONE answer row of a reviewer
 * generation's shadow cohort (plan, "Disagreements"). The store refuses — and
 * this route reports as 404 — any row whose call was not `reviewer = true` or
 * whose mode is not `shadow`, so a verdict can never land outside the cohort
 * the exit criterion counts.
 *
 * Authorization: the reviewer gate answers 404 first; middleware owns 401
 * (no session) and 403 (cookie POST without the CSRF header).
 */
export async function POST(request: NextRequest) {
  const denied = await requireJevReviewer(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { callId, questionIndex, review } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof callId !== "string" || callId === "") return badRequest();
  if (
    typeof questionIndex !== "number" ||
    !Number.isInteger(questionIndex) ||
    questionIndex < 0
  ) {
    return badRequest();
  }
  if (!isDecisionOwnerReview(review)) return badRequest();

  try {
    await getPlatformStore().decisionReceipts.setOwnerReview(
      callId,
      questionIndex,
      review as DecisionOwnerReview,
    );
  } catch {
    // Unknown row, or the store's refusal of a non-reviewer / non-shadow
    // row: both are "no such reviewable row", and neither may echo the
    // rejected input (the store's messages already name no values).
    return notFound();
  }
  return Response.json({ ok: true });
}

function badRequest(): Response {
  return new Response(JSON.stringify({ error: "bad_request" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
