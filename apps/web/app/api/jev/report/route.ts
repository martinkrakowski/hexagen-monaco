import { NextRequest } from "next/server";
import { requireJevReviewer } from "../reviewer-guard";
import { getPlatformStore } from "../../../../lib/platform";

/**
 * Jev J5b: the shadow-cohort agreement report behind the reviewer gate.
 *
 * The numbers are the exit criterion for `primary` (plan,
 * docs/planning/2026-10-16-jev-decision-advice.md, "Exit criterion"): the
 * store's `agreementReport` provides the counts and this route adds only what
 * it does not compute — the floor verdict. An empty or undersized cohort is
 * "not passed" (passed: false), never zero failures: absence of evidence is
 * not evidence of agreement (plan, "Floors").
 *
 * Authorization: the reviewer gate answers 404 before anything else; middleware
 * owns 401 (no session) and 403 (cookie POST without the CSRF header).
 */
const LLM_ROWS_FLOOR = 50;
const REVIEWER_CONTEXTS_FLOOR = 20;

export async function GET(request: NextRequest) {
  const denied = await requireJevReviewer(request);
  if (denied) return denied;

  const report = await getPlatformStore().decisionReceipts.agreementReport({
    use: "context-type",
    mode: "shadow",
  });

  const llmRows = report.llmCohort.total;
  const llmRowsMet = llmRows >= LLM_ROWS_FLOOR;
  const reviewerRows = report.reviewerCohort;
  const reviewerRowsMet = reviewerRows >= REVIEWER_CONTEXTS_FLOOR;

  return Response.json({
    use: "context-type",
    mode: "shadow",
    total: report.total,
    todaySource: report.todaySource,
    agreed: report.agreed,
    disagreed: report.disagreed,
    llmCohort: {
      ...report.llmCohort,
      // The exit criterion's "at least 90%": informational here — the floors
      // decide whether the cohort is even large enough to judge.
      agreementRate: llmRows > 0 ? report.llmCohort.agreed / llmRows : null,
    },
    reviewerCohort: report.reviewerCohort,
    ownerReview: report.ownerReview,
    floors: {
      llmRows: { required: LLM_ROWS_FLOOR, actual: llmRows, met: llmRowsMet },
      reviewerContexts: {
        required: REVIEWER_CONTEXTS_FLOOR,
        actual: reviewerRows,
        met: reviewerRowsMet,
      },
    },
    passed: llmRowsMet && reviewerRowsMet,
  });
}
