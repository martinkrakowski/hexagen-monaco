"use client";

import { useCallback, useMemo, useState } from "react";

import type { ScanFindings } from "@/lib/project-scan/types";
import {
  baselineRuleGroup,
  buildFindingsAdvisories,
  buildFindingsReviewRows,
  canRatifyFindings,
  clearAllBaselines,
  clearRuleGroupBaseline,
  describeBaselineConsequence,
  describeUnavailableFindings,
  groupRowsByRule,
  readScanFindings,
  setFindingBaselined,
  setFindingExpires,
  setFindingReason,
  summarizeFindingsSource,
  toBaselineDraft,
  toBaselinedFindingKeys,
  validateFindingsReview,
  type BrownfieldBaselineDraft,
  type FindingsAdvisory,
  type FindingsReviewRow,
  type FindingsReviewRuleGroup,
  type FindingsReviewSource,
  type FindingsReviewValidation,
  type FindingsSourceCounts,
} from "./baseline-draft";

/**
 * S5 state (F-19, BF-4.4) — the only stateful module in this packet.
 *
 * Everything it does is a call into `baseline-draft.ts`; it owns one
 * `useState` and nothing else. No fetch, no router, no storage: persisting the
 * draft is BF-3.4's job and is reached through `onDraftChange`, and advancing
 * the flow is the machine's job and is reached through `onRatifyFindings`.
 * There is deliberately no `router.push` anywhere in this packet — ratifying
 * raises `RATIFY_FINDINGS` and the machine decides what happens next.
 *
 * ## How the page composes this packet
 *
 * No container component, for the same reason as S3: the plan's chrome rule
 * puts Back and the primary button in `ProjectsShellWithFreeTier`'s `footer`
 * slot and never in the content column, so the screen is one hook feeding two
 * siblings that live in different slots.
 *
 * ```tsx
 * const review = useFindingsReview({
 *   findings: scan.findings,
 *   ratifiedKeys: view.baselinedFindingKeys,
 *   onDraftChange: (draft) => applyView({ ...view, baselineDraft: draft }),
 *   onRatifyFindings: (keys) =>
 *     dispatch({ type: "RATIFY_FINDINGS" }, { baselinedFindingKeys: keys }),
 * });
 *
 * <ProjectsShellWithFreeTier
 *   title="Import an existing codebase"
 *   footer={
 *     <FindingsReviewFooterActions
 *       validation={review.validation}
 *       consequence={review.consequence}
 *       onBack={() => dispatch({ type: "GO_BACK" })}
 *       onContinue={review.ratify}
 *     />
 *   }
 * >
 *   <FindingsReviewView
 *     groups={review.groups}
 *     advisories={review.advisories}
 *     counts={review.counts}
 *     unavailable={review.unavailable}
 *     validation={review.validation}
 *     consequence={review.consequence}
 *     onToggleBaselined={review.toggleBaselined}
 *     onReasonChange={review.changeReason}
 *     onExpiresChange={review.changeExpires}
 *     onBaselineRule={review.baselineRule}
 *     onClearRule={review.clearRule}
 *     onClearAll={review.clearAll}
 *   />
 * </ProjectsShellWithFreeTier>
 * ```
 */

export interface UseFindingsReviewOptions {
  /**
   * The scan's `findings` field, straight off the wire and UNNORMALISED.
   *
   * Taken raw rather than pre-split so the three-way distinction the contract
   * encodes (collected / could-not-collect / never-reported) is resolved in
   * exactly one place, `readScanFindings`. A caller that flattened it first
   * would have to decide what an absent field means, and that decision is the
   * one this seam exists to keep out of callers' hands.
   */
  findings: ScanFindings | null | undefined;
  /**
   * Decisions the user already made, replayed on top of the findings. This is
   * what makes Back from S6 non-destructive.
   */
  ratifiedKeys?: readonly string[] | null;
  /** Called with the projected baseline after every edit (BF-3.4 seam). */
  onDraftChange?: (draft: BrownfieldBaselineDraft) => void;
  /** Called only when the draft may legally be ratified. */
  onRatifyFindings?: (
    baselinedFindingKeys: string[],
    draft: BrownfieldBaselineDraft,
  ) => void;
  /**
   * Injection point for the clock. Expiry is the one rule on this screen whose
   * answer changes with the wall clock, so a test needs to be able to say when
   * "now" is. Defaults to a date captured once at mount rather than read per
   * render: re-reading it would make `validation` a new object on every render
   * for no reason anyone can observe.
   */
  now?: Date;
}

export interface UseFindingsReviewResult {
  /** Flat rows, in the linter's own order. */
  rows: readonly FindingsReviewRow[];
  /** The same rows grouped dynamically by rule, largest group first. */
  groups: readonly FindingsReviewRuleGroup[];
  /** Stale and expired baseline entries — read-only on this screen. */
  advisories: readonly FindingsAdvisory[];
  /** Bucket totals for the summary pills, or `null` when nothing was read. */
  counts: FindingsSourceCounts | null;
  /**
   * Finished title/description for the arms where there is no list to review,
   * or `null` when there is. Non-null is not "empty" — it is "we could not
   * look", and the view must render it as such.
   */
  unavailable: { readonly title: string; readonly description: string } | null;
  source: FindingsReviewSource;
  validation: FindingsReviewValidation;
  /** One sentence naming what continuing will actually do. */
  consequence: string;
  /** True when `ratify()` will do something. */
  canRatify: boolean;
  toggleBaselined: (key: string, baselined: boolean) => void;
  changeReason: (key: string, reason: string) => void;
  changeExpires: (key: string, expires: string) => void;
  /** Bulk-accept one rule's findings under one stated reason. */
  baselineRule: (rule: string, reason: string) => void;
  clearRule: (rule: string) => void;
  clearAll: () => void;
  /** Projects and hands off the draft. A no-op while `canRatify` is false. */
  ratify: () => void;
}

export function useFindingsReview({
  findings,
  ratifiedKeys,
  onDraftChange,
  onRatifyFindings,
  now,
}: UseFindingsReviewOptions): UseFindingsReviewResult {
  const source = useMemo(() => readScanFindings(findings), [findings]);

  const [mountedNow] = useState(() => new Date());
  const effectiveNow = now ?? mountedNow;

  const [rows, setRows] = useState<readonly FindingsReviewRow[]>(() =>
    buildFindingsReviewRows(source, ratifiedKeys),
  );

  /**
   * Rebuild when a NEW scan arrives, using React's documented
   * adjust-state-during-render pattern rather than an effect. An effect would
   * paint one frame of the previous scan's findings first, which on this
   * screen means showing somebody else's debt attached to this user's
   * decisions.
   *
   * Keyed on a CONTENT SIGNATURE, not on the `findings` object identity.
   * Reference keying looks cheaper and is a trap: a caller passing an inline
   * literal hands this a fresh object every render, so the reset fires every
   * render and React aborts with "Too many re-renders" — it does not degrade,
   * it crashes the screen. (`useLayoutRatify` learned this the same way; its
   * own tests hit it.) The signature also gives the better semantics: an
   * identical re-fetch leaves the user's decisions alone.
   */
  const findingsSignature = useMemo(
    () =>
      source.kind === "collected"
        ? JSON.stringify([
            source.kind,
            source.fresh,
            source.baselined,
            source.stale,
            source.expired,
          ])
        : JSON.stringify(source),
    [source],
  );
  const [signatureSource, setSignatureSource] = useState(findingsSignature);
  if (signatureSource !== findingsSignature) {
    setSignatureSource(findingsSignature);
    setRows(buildFindingsReviewRows(source, ratifiedKeys));
  }

  /**
   * Replay decisions that ARRIVE LATE.
   *
   * BF-3.4's `useBrownfieldDraft` cannot return a restored draft on the first
   * render: it feeds useSyncExternalStore a server snapshot of `null` so the
   * server render and the hydration render agree, and only flips to the stored
   * value after hydration commits. So `ratifiedKeys` is reliably null at mount
   * and arrives one render later with `findings` unchanged — which the
   * signature above cannot see. Without this the user's saved review is
   * silently discarded, which on this screen means silently re-enforcing debt
   * they already accepted.
   *
   * Keyed on the array's own identity so it replays once per arrival and never
   * re-applies over later edits. A null/absent value is not an arrival.
   */
  const [replayedKeys, setReplayedKeys] = useState(ratifiedKeys);
  if (ratifiedKeys !== replayedKeys) {
    setReplayedKeys(ratifiedKeys);
    if (ratifiedKeys !== null && ratifiedKeys !== undefined) {
      setRows(buildFindingsReviewRows(source, ratifiedKeys));
    }
  }

  const groups = useMemo(() => groupRowsByRule(rows), [rows]);
  const advisories = useMemo(() => buildFindingsAdvisories(source), [source]);
  const counts = useMemo(() => summarizeFindingsSource(source), [source]);
  // Copy comes from the pure module, never assembled here: the whole point of
  // `describeUnavailableFindings` is that the sentence explaining a failed
  // read has one home and can be asserted without rendering anything.
  const unavailable = useMemo(
    () => describeUnavailableFindings(source),
    [source],
  );

  const validation = useMemo(
    () => validateFindingsReview(rows, source, effectiveNow),
    [rows, source, effectiveNow],
  );
  const consequence = useMemo(
    () => describeBaselineConsequence(validation),
    [validation],
  );

  /**
   * Set-and-notify. Written against the `rows` captured by this render rather
   * than through a functional updater on purpose, matching `useLayoutRatify`
   * and `BrownfieldImportPage`: `onDraftChange` is a side effect (BF-3.4
   * writes it to storage), React may invoke a functional updater twice, and a
   * write inside one would fire twice under StrictMode. Every caller below is
   * an event handler running after commit, so the captured `rows` is committed.
   */
  const applyRows = useCallback(
    (next: readonly FindingsReviewRow[]) => {
      if (next === rows) return;
      setRows(next);
      onDraftChange?.(toBaselineDraft(next));
    },
    [rows, onDraftChange],
  );

  const toggleBaselined = useCallback(
    (key: string, baselined: boolean) => {
      applyRows(setFindingBaselined(rows, key, baselined));
    },
    [rows, applyRows],
  );

  const changeReason = useCallback(
    (key: string, reason: string) => {
      applyRows(setFindingReason(rows, key, reason));
    },
    [rows, applyRows],
  );

  const changeExpires = useCallback(
    (key: string, expires: string) => {
      applyRows(setFindingExpires(rows, key, expires));
    },
    [rows, applyRows],
  );

  const baselineRule = useCallback(
    (rule: string, reason: string) => {
      applyRows(baselineRuleGroup(rows, rule, reason));
    },
    [rows, applyRows],
  );

  const clearRule = useCallback(
    (rule: string) => {
      applyRows(clearRuleGroupBaseline(rows, rule));
    },
    [rows, applyRows],
  );

  const clearAll = useCallback(() => {
    applyRows(clearAllBaselines(rows));
  }, [rows, applyRows]);

  const canRatify = validation.blockingReason === null;

  const ratify = useCallback(() => {
    // Re-checked here rather than trusting the caller to have disabled the
    // button: a keyboard Enter on a form, or a future caller wiring this to
    // something other than the footer, must not be able to write a baseline
    // that the linter would reject — or, worse, an empty one standing in for a
    // scan whose findings were never read.
    if (!canRatifyFindings(rows, source, effectiveNow)) return;
    onRatifyFindings?.(toBaselinedFindingKeys(rows), toBaselineDraft(rows));
  }, [rows, source, effectiveNow, onRatifyFindings]);

  return {
    rows,
    groups,
    advisories,
    counts,
    unavailable,
    source,
    validation,
    consequence,
    canRatify,
    toggleBaselined,
    changeReason,
    changeExpires,
    baselineRule,
    clearRule,
    clearAll,
    ratify,
  };
}
