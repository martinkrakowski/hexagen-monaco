import { NextRequest } from "next/server";
import { requireJevReviewer } from "../reviewer-guard";
import { createJevDecisionAdvice } from "../../../../app/lib/wire.server";
import { getPlatformStore } from "../../../../lib/platform";

/**
 * Jev J5b: the shadow-cohort agreement report behind the reviewer gate.
 *
 * The numbers are the exit criterion for `primary` (plan,
 * docs/planning/2026-10-16-jev-decision-advice.md, "Exit criterion"): the
 * store's `agreementReport` provides the counts and this route adds only what
 * it does not compute — the verdict itself. `passed` applies the FULL rule:
 * the floors (an empty or undersized cohort is "not passed", never zero
 * failures), at least 90% agreement on the llm cohort, at most 1 `llm_better`
 * in 10 of the reviewed disagreements, and no `llm_better` row whose Jev
 * confidence reached the threshold (plan, "Rule").
 *
 * Authorization: the reviewer gate answers 404 before anything else; middleware
 * owns 401 (no session) and 403 (cookie POST without the CSRF header).
 */
const LLM_ROWS_FLOOR = 50;
const REVIEWER_CONTEXTS_FLOOR = 20;

/**
 * The threshold the exit rule compares `llm_better` confidences against: the
 * jev config when the advice port is active, else the env read the same way
 * wire.server reads it (negative is malformed → default 0.8, above 1 clamps
 * to 1), else the plan's default 0.8.
 */
function exitThreshold(): number {
  const configured = createJevDecisionAdvice()?.minConfidence;
  if (typeof configured === "number") return configured;
  const raw = Number(process.env.JEV_CONTEXT_TYPE_MIN_CONFIDENCE);
  if (!Number.isFinite(raw) || raw < 0) return 0.8;
  return Math.min(1, raw);
}

export async function GET(request: NextRequest) {
  const denied = await requireJevReviewer(request);
  if (denied) return denied;

  const threshold = exitThreshold();
  const report = await getPlatformStore().decisionReceipts.agreementReport({
    use: "context-type",
    mode: "shadow",
    threshold,
  });

  const llmRows = report.llmCohort.total;
  const llmRowsMet = llmRows >= LLM_ROWS_FLOOR;
  const reviewerRows = report.reviewerCohort;
  const reviewerRowsMet = reviewerRows >= REVIEWER_CONTEXTS_FLOOR;
  const floorsMet = llmRowsMet && reviewerRowsMet;

  // The exit criterion's "at least 90%" of the llm cohort. With the floors
  // met the cohort cannot be empty, so null can only mean "not passed".
  const agreementRate = llmRows > 0 ? report.llmCohort.agreed / llmRows : null;
  const agreementMet = agreementRate !== null && agreementRate >= 0.9;
  // The rule's "at most 1 in 10": llm_better * 10 <= reviewed disagreements.
  const llmBetterOk = report.llmBetter * 10 <= report.reviewedDisagreements;
  // "No llm_better case had a Jev confidence at or above the threshold."
  const confidenceOk = report.llmBetterAtOrAboveThreshold === 0;

  return Response.json({
    use: "context-type",
    mode: "shadow",
    total: report.total,
    todaySource: report.todaySource,
    agreed: report.agreed,
    disagreed: report.disagreed,
    llmCohort: {
      ...report.llmCohort,
      agreementRate,
    },
    reviewerCohort: report.reviewerCohort,
    ownerReview: report.ownerReview,
    exitRule: {
      threshold,
      agreementRate,
      agreementMet,
      reviewedDisagreements: report.reviewedDisagreements,
      llmBetter: report.llmBetter,
      llmBetterAtOrAboveThreshold: report.llmBetterAtOrAboveThreshold,
      llmBetterOk,
      confidenceOk,
    },
    floors: {
      llmRows: { required: LLM_ROWS_FLOOR, actual: llmRows, met: llmRowsMet },
      reviewerContexts: {
        required: REVIEWER_CONTEXTS_FLOOR,
        actual: reviewerRows,
        met: reviewerRowsMet,
      },
    },
    floorsMet,
    passed: floorsMet && agreementMet && llmBetterOk && confidenceOk,
  });
}
