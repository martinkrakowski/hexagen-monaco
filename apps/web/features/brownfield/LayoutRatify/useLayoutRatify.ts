"use client";

import { useCallback, useMemo, useState } from "react";

import type { BrownfieldLayoutDraft } from "../BrownfieldFlow/types";
import {
  buildLayoutRatifyRows,
  canRatifyLayout,
  mergeRatifiedDraft,
  renameContext,
  resetRowToDetected,
  setContextIncluded,
  setLayerDirectories,
  toLayoutDraft,
  validateLayoutRows,
  type DetectedPackageSummary,
  type LayoutLayerName,
  type LayoutRatifyRow,
  type LayoutRatifyValidation,
} from "./layout-draft";

/**
 * S3 state (F-17, BF-4.1) — the only stateful module in this packet.
 *
 * Everything it does is a call into `layout-draft.ts`; it owns a `useState`
 * and nothing else. No fetch, no router, no storage: persisting the draft is
 * BF-3.4's job and is reached through `onDraftChange`, and advancing the flow
 * is the machine's job and is reached through `onRatifyLayout`. There is
 * deliberately no `router.push` anywhere in this packet — ratifying raises
 * `RATIFY_LAYOUT` and the machine decides what happens next.
 *
 * ## How the page composes this packet
 *
 * There is no container component here on purpose: the plan's chrome rule puts
 * Back and the primary button in `ProjectsShellWithFreeTier`'s `footer` slot
 * and never in the content column, so the screen is one hook feeding two
 * siblings that live in different slots.
 *
 * ```tsx
 * const layout = useLayoutRatify({
 *   packages,
 *   ratifiedDraft: view.layoutDraft,
 *   onDraftChange: (draft) => applyView({ ...view, layoutDraft: draft }),
 *   onRatifyLayout: (draft) =>
 *     dispatch({ type: "RATIFY_LAYOUT" }, { layoutDraft: draft }),
 * });
 *
 * <ProjectsShellWithFreeTier
 *   title="Import an existing codebase"
 *   footer={
 *     <LayoutRatifyFooterActions
 *       validation={layout.validation}
 *       onBack={() => dispatch({ type: "GO_BACK" })}
 *       onContinue={layout.ratify}
 *     />
 *   }
 * >
 *   <LayoutRatifyView
 *     rows={layout.rows}
 *     validation={layout.validation}
 *     onToggleInclude={layout.toggleInclude}
 *     onRenameContext={layout.rename}
 *     onLayerDirectoriesChange={layout.changeLayerDirectories}
 *     onResetRow={layout.resetRow}
 *   />
 * </ProjectsShellWithFreeTier>
 * ```
 */

export interface UseLayoutRatifyOptions {
  /** What the scan detected. Identity change = a new scan; see `rebuild`. */
  packages: readonly DetectedPackageSummary[];
  /**
   * A draft the user already ratified, replayed on top of the detection. This
   * is what makes Back from S4 non-destructive — the machine allows
   * `manifest_ratify -> layout_ratify`, so re-entering S3 must show the
   * confirmed mapping rather than the proposal again.
   */
  ratifiedDraft?: BrownfieldLayoutDraft | null;
  /** Called with the in-progress draft after every edit (BF-3.4 seam). */
  onDraftChange?: (draft: BrownfieldLayoutDraft) => void;
  /** Called only when the draft may legally be ratified. */
  onRatifyLayout?: (draft: BrownfieldLayoutDraft) => void;
}

export interface UseLayoutRatifyResult {
  rows: readonly LayoutRatifyRow[];
  validation: LayoutRatifyValidation;
  /** True when `ratify()` will do something. */
  canRatify: boolean;
  toggleInclude: (packageRoot: string, include: boolean) => void;
  rename: (packageRoot: string, contextName: string) => void;
  changeLayerDirectories: (
    packageRoot: string,
    layer: LayoutLayerName,
    directories: string[],
  ) => void;
  resetRow: (packageRoot: string) => void;
  /** Projects and hands off the draft. A no-op while `canRatify` is false. */
  ratify: () => void;
}

function initialRows(
  packages: readonly DetectedPackageSummary[],
  ratifiedDraft: BrownfieldLayoutDraft | null | undefined,
): readonly LayoutRatifyRow[] {
  return mergeRatifiedDraft(buildLayoutRatifyRows(packages), ratifiedDraft);
}

export function useLayoutRatify({
  packages,
  ratifiedDraft,
  onDraftChange,
  onRatifyLayout,
}: UseLayoutRatifyOptions): UseLayoutRatifyResult {
  const [rows, setRows] = useState<readonly LayoutRatifyRow[]>(() =>
    initialRows(packages, ratifiedDraft),
  );

  /**
   * Rebuild when a NEW scan arrives, using React's documented
   * adjust-state-during-render pattern rather than an effect. An effect would
   * paint one frame of the previous repository's packages first, which on this
   * screen means showing a mapping that belongs to somebody else's codebase.
   *
   * Keyed on a CONTENT SIGNATURE, not on the `packages` array reference.
   *
   * Reference keying looks cheaper and is a trap: a caller passing an inline
   * literal — `useLayoutRatify({ packages: detect(), … })`, the most natural
   * way to write it — hands this a fresh array every render, so the reset
   * fires every render and React aborts with "Too many re-renders". It does
   * not degrade, it crashes the screen. This hook's own tests hit it.
   *
   * The signature also gives better semantics than the reference did: two
   * scans that found the SAME packages leave the user's edits alone, and only
   * a genuinely different detection rebuilds the rows. Discarding someone's
   * ratification because an identical array arrived with a new identity was
   * never the intent.
   */
  const detectionSignature = useMemo(
    () =>
      JSON.stringify(
        packages.map((pkg) => [
          pkg.root,
          pkg.name,
          // Sorted so an equivalent detection that merely enumerated its
          // layers in another order does not read as a different scan.
          Object.entries(pkg.layers ?? {})
            .map(([layer, dirs]) => [layer, [...(dirs ?? [])]] as const)
            .sort((a, b) => a[0].localeCompare(b[0])),
        ]),
      ),
    [packages],
  );
  const [detectionSource, setDetectionSource] = useState(detectionSignature);
  if (detectionSource !== detectionSignature) {
    setDetectionSource(detectionSignature);
    setRows(initialRows(packages, ratifiedDraft));
  }

  /**
   * Replay a draft that ARRIVES LATE.
   *
   * `ratifiedDraft` was read once at mount. But BF-3.4's `useBrownfieldDraft`
   * cannot return a restored draft on the first render: it feeds
   * useSyncExternalStore a server snapshot of `null` so the server render and
   * the hydration render agree, and only flips to the stored value after
   * hydration commits. So the draft is reliably null when this hook mounts,
   * and arrives one render later with `packages` unchanged -- which the
   * detection signature above cannot see. The user's saved ratification was
   * silently discarded every time.
   *
   * Keyed on the draft's own identity so it replays once per arrival, and
   * never re-applies over later edits. A null draft is not an arrival.
   */
  const [replayedDraft, setReplayedDraft] = useState(ratifiedDraft);
  if (ratifiedDraft !== replayedDraft) {
    setReplayedDraft(ratifiedDraft);
    if (ratifiedDraft !== null && ratifiedDraft !== undefined) {
      setRows(initialRows(packages, ratifiedDraft));
    }
  }

  const validation = useMemo(() => validateLayoutRows(rows), [rows]);

  /**
   * Set-and-notify. Written against the `rows` captured by this render rather
   * than through a functional updater on purpose, matching the precedent set
   * in `BrownfieldImportPage`: `onDraftChange` is a side effect (BF-3.4 writes
   * it to storage), React may invoke a functional updater twice, and a write
   * inside one would fire twice under StrictMode. Every caller below is an
   * event handler running after commit, so the captured `rows` is committed.
   */
  const applyRows = useCallback(
    (next: readonly LayoutRatifyRow[]) => {
      if (next === rows) return;
      setRows(next);
      onDraftChange?.(toLayoutDraft(next));
    },
    [rows, onDraftChange],
  );

  const toggleInclude = useCallback(
    (packageRoot: string, include: boolean) => {
      applyRows(setContextIncluded(rows, packageRoot, include));
    },
    [rows, applyRows],
  );

  const rename = useCallback(
    (packageRoot: string, contextName: string) => {
      applyRows(renameContext(rows, packageRoot, contextName));
    },
    [rows, applyRows],
  );

  const changeLayerDirectories = useCallback(
    (packageRoot: string, layer: LayoutLayerName, directories: string[]) => {
      applyRows(setLayerDirectories(rows, packageRoot, layer, directories));
    },
    [rows, applyRows],
  );

  const resetRow = useCallback(
    (packageRoot: string) => {
      applyRows(resetRowToDetected(rows, packageRoot));
    },
    [rows, applyRows],
  );

  const canRatify = validation.blockingReason === null;

  const ratify = useCallback(() => {
    // Re-checked here rather than trusting the caller to have disabled the
    // button: a keyboard Enter on a form, or a future caller wiring this to
    // something other than the footer, must not be able to hand the flow an
    // empty or colliding layout.
    if (!canRatifyLayout(rows)) return;
    onRatifyLayout?.(toLayoutDraft(rows));
  }, [rows, onRatifyLayout]);

  return {
    rows,
    validation,
    canRatify,
    toggleInclude,
    rename,
    changeLayerDirectories,
    resetRow,
    ratify,
  };
}
