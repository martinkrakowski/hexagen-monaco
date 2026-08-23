"use client";

import type { BrownfieldLayoutDraft } from "../BrownfieldFlow/types";
import {
  BrownfieldNotice,
  BrownfieldScreenFrame,
} from "../views/BrownfieldScreenFrame";
import {
  LayoutRatifyFooterActions,
  LayoutRatifyView,
} from "./LayoutRatifyView";
import type { DetectedPackageSummary } from "./layout-draft";
import { useLayoutRatify } from "./useLayoutRatify";

/**
 * S3 container (F-17, BF-4.1) — the only export a host screen needs.
 *
 * Wires `useLayoutRatify` to the presentational `LayoutRatifyView`, and raises
 * `onRatify` / `onBack` as intents. It performs no I/O and no navigation:
 * ratifying raises `RATIFY_LAYOUT` in the host and the STATE MACHINE decides
 * what happens next, which is the same discipline `ManifestRatify` records.
 *
 * ## Convention followed, and the one place it deviates
 *
 * Shape, prop names and the "hand the host a validated draft and stop" rule all
 * come from `ManifestRatify` (S4). One thing is deliberately different, and it
 * is not a second convention so much as the plan's own chrome rule applied:
 * `ManifestRatifyView` renders its Back/Continue INSIDE the content column,
 * while §1.3 of the feature plan puts them in `ProjectsShellWithFreeTier`'s
 * `footer` slot ("footer: [← Back] 5 of 7 included [Continue →]") — and
 * `LayoutRatifyView`, `FindingsReviewView` and `ReportView` all take no action
 * props at all, precisely because their authors were writing to that rule.
 *
 * A view with no buttons and a footer slot two components up is a two-slot
 * problem, and there is exactly one shape that fills both slots from ONE hook
 * instance: the container renders the shell itself. That is what this does. It
 * also buys the per-screen content width the plan asks for (S1 `max-w-3xl`, S3
 * `max-w-4xl`), which a single shell shared by every state cannot express.
 *
 * ## Why `packages` comes in rather than being read here
 *
 * The scan is server state, held by the flow host for the lifetime of the run
 * and deliberately never persisted (BF-3.4's split). `readDetectedPackages` in
 * `BrownfieldFlow/scan-artifacts.ts` is the parser; the host calls it and hands
 * the result down, so this component stays renderable from a literal in a test.
 */
export interface LayoutRatifyProps {
  /** What the scan detected, parsed from the envelope's `layout` text. */
  packages: readonly DetectedPackageSummary[];
  /**
   * A draft the user already ratified, replayed over the detection. Non-null on
   * the way back from S4, and on a resumed run.
   */
  ratifiedDraft?: BrownfieldLayoutDraft | null;
  /** Carried project name, shown for orientation. */
  projectName?: string;
  /**
   * What could not be read out of the returned layout, already phrased for the
   * user, or `null`. Rendered ABOVE the grid rather than swallowed: an empty
   * grid with no explanation reads as "your repository has no packages", which
   * is a claim about the user's code that this screen has no basis to make.
   */
  detectionProblem?: string | null;
  /** Persisted after every edit (BF-3.4 seam). */
  onDraftChange: (draft: BrownfieldLayoutDraft) => void;
  /** Called once, with a ratifiable draft, when the user presses Continue. */
  onRatify: (draft: BrownfieldLayoutDraft) => void;
  /** Back to S1. The host decides what that means for the run. */
  onBack: () => void;
}

export function LayoutRatify({
  packages,
  ratifiedDraft,
  projectName,
  detectionProblem = null,
  onDraftChange,
  onRatify,
  onBack,
}: LayoutRatifyProps) {
  const layout = useLayoutRatify({
    packages,
    ratifiedDraft,
    onDraftChange,
    onRatifyLayout: onRatify,
  });

  // The footer buttons are the slice's OWN component, not a local pair. It
  // already owns the `aria-describedby` that tells a keyboard user why Continue
  // is dead, and re-deriving "may this be ratified?" here would drift from
  // `validateLayoutRows` on the first rule added.
  const footer = (
    <LayoutRatifyFooterActions
      validation={layout.validation}
      onBack={onBack}
      onContinue={layout.ratify}
    />
  );

  return (
    <BrownfieldScreenFrame measure="wide" footer={footer}>
      {detectionProblem === null ? null : (
        <BrownfieldNotice assertive>{detectionProblem}</BrownfieldNotice>
      )}
      <LayoutRatifyView
        rows={layout.rows}
        validation={layout.validation}
        projectName={projectName}
        onToggleInclude={layout.toggleInclude}
        onRenameContext={layout.rename}
        onLayerDirectoriesChange={layout.changeLayerDirectories}
        onResetRow={layout.resetRow}
      />
    </BrownfieldScreenFrame>
  );
}
