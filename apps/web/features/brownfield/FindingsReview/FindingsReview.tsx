"use client";

import { useCallback } from "react";
import type { ScanFindings } from "@/lib/project-scan/types";
import { BrownfieldScreenFrame } from "../views/BrownfieldScreenFrame";
import {
  FindingsReviewFooterActions,
  FindingsReviewView,
} from "./FindingsReviewView";
import { findingKey, type BrownfieldBaselineDraft } from "./baseline-draft";
import { useFindingsReview } from "./useFindingsReview";

/**
 * S5 container (F-19, BF-4.4) — the only export a host screen needs.
 *
 * Wires `useFindingsReview` to the presentational `FindingsReviewView` and
 * raises `onRatify` / `onBack` as intents. No fetch, no router: ratifying
 * raises `RATIFY_FINDINGS` in the host and the machine decides what comes next.
 * Same shape as `LayoutRatify`, and the same one documented deviation from
 * `ManifestRatify` — the container renders the shell so the Back/Continue
 * actions can live in the footer slot the plan's chrome rule puts them in.
 *
 * ## Why the persistence callback hands back KEYS, not the baseline draft
 *
 * `useFindingsReview`'s own `onDraftChange` emits a `BrownfieldBaselineDraft`,
 * and its docblock example writes it to `view.baselineDraft` — a field that
 * does not exist on `BrownfieldFlowViewState` and, by BF-3.4's policy, must not:
 * a baseline draft embeds the findings themselves, which are a point-in-time
 * copy of somebody's repository and are explicitly on the DROPPED side of the
 * persist/drop table. What the flow persists is `baselinedFindingKeys`, the
 * user's DECISION, which re-applies cleanly against a freshly fetched list.
 *
 * So the projection happens here, once, rather than in each host: the entries
 * are re-keyed with the linter's own `findingKey`, which is the same identity
 * the rows were built with, so a key round-trips exactly.
 *
 * KNOWN CONSEQUENCE, stated rather than papered over: `toBaselineDraft` drops a
 * row that is ticked but has no justification yet, because such a row cannot
 * legally be written to a baseline file. So a half-made decision — accepted,
 * reason still empty — is not persisted mid-edit; it becomes persistable the
 * moment a reason is typed. That is survivable here specifically because
 * `resumableStateFor("findings_review")` already walks a resumed run back to
 * `manifest_ratify`, so nobody is restored INTO a half-edited review. The
 * alternative (persisting from the rows through an effect) reintroduces exactly
 * the StrictMode double-write this slice's hooks avoid by construction.
 */
export interface FindingsReviewProps {
  /**
   * The scan's `findings` field, straight off the wire and UNNORMALISED — the
   * three-way collected / could-not-collect / never-reported distinction is
   * resolved in one place, inside the hook.
   */
  findings: ScanFindings | null | undefined;
  /** Decisions the user already made, replayed by key. */
  ratifiedKeys?: readonly string[] | null;
  /** Carried project name, shown for orientation. */
  projectName?: string;
  /** Persisted after every edit (BF-3.4 seam). Receives the decision, not the list. */
  onDecisionsChange?: (baselinedFindingKeys: string[]) => void;
  /** Called once, with a ratifiable review, when the user presses Continue. */
  onRatify: (
    baselinedFindingKeys: string[],
    draft: BrownfieldBaselineDraft,
  ) => void;
  /** Back to S4. */
  onBack: () => void;
  /** Clock injection for expiry validation. Tests pass a fixed date. */
  now?: Date;
}

export function FindingsReview({
  findings,
  ratifiedKeys,
  projectName,
  onDecisionsChange,
  onRatify,
  onBack,
  now,
}: FindingsReviewProps) {
  const handleDraftChange = useCallback(
    (draft: BrownfieldBaselineDraft) => {
      onDecisionsChange?.(draft.entries.map((entry) => findingKey(entry)));
    },
    [onDecisionsChange],
  );

  const review = useFindingsReview({
    findings,
    ratifiedKeys,
    onDraftChange: handleDraftChange,
    onRatifyFindings: onRatify,
    now,
  });

  // The slice's own footer component: it already announces the consequence to a
  // keyboard user before Continue is pressed, and the blocking reason when it
  // cannot be.
  const footer = (
    <FindingsReviewFooterActions
      validation={review.validation}
      consequence={review.consequence}
      onBack={onBack}
      onContinue={review.ratify}
    />
  );

  return (
    <BrownfieldScreenFrame measure="wide" footer={footer}>
      <FindingsReviewView
        groups={review.groups}
        advisories={review.advisories}
        counts={review.counts}
        unavailable={review.unavailable}
        validation={review.validation}
        consequence={review.consequence}
        projectName={projectName}
        onToggleBaselined={review.toggleBaselined}
        onReasonChange={review.changeReason}
        onExpiresChange={review.changeExpires}
        onBaselineRule={review.baselineRule}
        onClearRule={review.clearRule}
        onClearAll={review.clearAll}
      />
    </BrownfieldScreenFrame>
  );
}
