"use client";

import { useCallback, useMemo } from "react";
import type { BrownfieldManifestContextDraft, BrownfieldManifestDraft } from "../BrownfieldFlow/types";
import { ManifestRatifyView } from "./ManifestRatifyView";
import {
  toRatificationPayload,
  toggleDependency,
  updateContextAt,
  validateManifestDraft,
  type ManifestArchitecture,
  type ManifestRatificationPayload,
} from "./manifest-draft";
import { previewScope } from "./scope-preview";

/**
 * S4 container — the only export a host screen needs.
 *
 * Wires the pure rules (`manifest-draft.ts`, `scope-preview.ts`) to the
 * presentational `ManifestRatifyView`. It performs no I/O: writing the manifest
 * is `POST /api/projects/bootstrap` (BF-4.3), which the flow's boundary
 * component owns because it is the thing that also knows the scan id, the quota
 * cookie and the draft store.
 *
 * ## Why the draft is CONTROLLED
 *
 * `draft` comes in and `onDraftChange` goes out; this component holds no copy.
 * The flow keeps every ratification draft in one reducer (the plan's "S4→S3 and
 * S5→S4 are free — drafts are held in one reducer, not per-step"), and a local
 * `useState` seeded from a prop would quietly fork it: walking back to S3 and
 * returning would either resurrect stale edits or drop fresh ones, depending on
 * whether the component happened to remount. Controlled is the only shape that
 * makes Back cheap and correct.
 *
 * ## Why ratifying does not navigate
 *
 * `onRatify` hands the host a validated payload and stops. It does not call
 * `router.push`, and it does not decide which screen comes next — `RATIFY_MANIFEST`
 * carries `freshFindingCount`, and the state machine, not this component, is what
 * knows that a zero skips `findings_review` and goes straight to `report`. A
 * success arm that routes is how a flow ends up with two disagreeing ideas of
 * where the user is.
 */
export interface ManifestRatifyProps {
  draft: BrownfieldManifestDraft;
  onDraftChange: (next: BrownfieldManifestDraft) => void;
  /** Back to S3. The host decides what that means for the layout draft. */
  onBack: () => void;
  /**
   * Called once, with a draft `validateManifestDraft` accepted, when the user
   * presses Continue. `payload` is the normalised `BootstrapAnswers` body;
   * `draft` is the un-normalised draft to keep in the reducer so returning to
   * this screen shows what the user actually typed.
   */
  onRatify: (
    payload: ManifestRatificationPayload,
    draft: BrownfieldManifestDraft,
  ) => void;
}

export function ManifestRatify({
  draft,
  onDraftChange,
  onBack,
  onRatify,
}: ManifestRatifyProps) {
  // Both are pure functions of the draft, and both run on every keystroke in
  // the scope field, so they are memoized on the draft rather than recomputed
  // per render of an unrelated row.
  const scopePreview = useMemo(() => previewScope(draft.scope), [draft.scope]);
  const problems = useMemo(() => validateManifestDraft(draft), [draft]);

  const handleChangeSystem = useCallback(
    (system: string) => {
      onDraftChange({ ...draft, system });
    },
    [draft, onDraftChange],
  );

  const handleChangeScope = useCallback(
    (scope: string) => {
      // Stored verbatim. The sanitized form is shown next to the field and
      // applied at `toRatificationPayload`; rewriting the input as the user
      // types would move their cursor and hide the rule that fired.
      onDraftChange({ ...draft, scope });
    },
    [draft, onDraftChange],
  );

  const handleChangeArchitecture = useCallback(
    (architecture: ManifestArchitecture) => {
      onDraftChange({ ...draft, architecture });
    },
    [draft, onDraftChange],
  );

  const handlePatchContext = useCallback(
    (index: number, patch: Partial<BrownfieldManifestContextDraft>) => {
      onDraftChange(updateContextAt(draft, index, patch));
    },
    [draft, onDraftChange],
  );

  const handleToggleDependency = useCallback(
    (index: number, target: string, shouldDepend: boolean) => {
      onDraftChange(toggleDependency(draft, index, target, shouldDepend));
    },
    [draft, onDraftChange],
  );

  const handleContinue = useCallback(() => {
    // The view already disables the button, but the guard is repeated here on
    // purpose: the button is one caller, and a disabled attribute is a UI
    // affordance rather than an invariant. Nothing may leave this component for
    // the bootstrap route unless the same validator that renders the errors
    // agrees the draft is writable.
    if (validateManifestDraft(draft).length > 0) return;
    onRatify(toRatificationPayload(draft), draft);
  }, [draft, onRatify]);

  return (
    <ManifestRatifyView
      draft={draft}
      scopePreview={scopePreview}
      problems={problems}
      onChangeSystem={handleChangeSystem}
      onChangeScope={handleChangeScope}
      onChangeArchitecture={handleChangeArchitecture}
      onPatchContext={handlePatchContext}
      onToggleDependency={handleToggleDependency}
      onBack={onBack}
      onContinue={handleContinue}
    />
  );
}
