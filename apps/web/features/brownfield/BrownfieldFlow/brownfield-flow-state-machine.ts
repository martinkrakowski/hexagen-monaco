/**
 * Brownfield adoption flow — screen state machine.
 *
 * Mirrors the shape of `ModelSelectionFlow/model-selection-state-machine.ts`:
 * a state union, an event union, a module-private transition table, and the
 * five predicates the flow hooks consume.
 *
 * Doctrine (see docs/planning/2026-08-20-brownfield-ui-plan.md): ratification,
 * not auto-detection. Three consequences are encoded structurally here rather
 * than left to the views:
 *
 *  1. `report` is terminal-WITH-ACTIONS. It never auto-navigates: no event
 *     other than an explicit `INSTALL_GATE` moves off it, so a background
 *     completion cannot push the user past the artifact they came to read.
 *  2. `blocked` is RECOVERABLE — "try another tier" walks back to `tier_pick`
 *     instead of dead-ending the run.
 *  3. A scan is a POINT-IN-TIME artifact. `layout_ratify` -> `scanning` is not
 *     a legal edge; Back from `layout_ratify` returns to `tier_pick`, which
 *     starts a new run rather than silently re-running the old one.
 */

/** Privacy tier chosen on the entry screen, before any code moves. */
export type BrownfieldTier =
  /** Tier A — user uploads locally produced `hexagen scan --handoff` artifacts. */
  | "artifacts"
  /** Tier B — server shallow-clones the repo, scans in a tmpdir, discards it. */
  | "clone"
  /** Tier C — user uploads a zip of the repo. */
  | "zip";

/** Why a run stopped. The user-facing copy for each reason lives in the view. */
export type BrownfieldBlockReason =
  | "upload-rejected"
  | "repo-unreachable"
  | "repo-too-large"
  | "no-workspaces-detected"
  | "could-not-run";

export type BrownfieldFlowState =
  | "tier_pick"
  | "uploading"
  | "repo_entry"
  | "scanning"
  | "blocked"
  | "layout_ratify"
  | "manifest_ratify"
  | "findings_review"
  | "report"
  | "gate_install";

export type BrownfieldFlowEvent =
  | { type: "SELECT_TIER"; tier: BrownfieldTier }
  | { type: "SUBMIT_REPO_REF"; repoUrl: string; ref: string }
  | { type: "UPLOAD_COMPLETE" }
  | { type: "UPLOAD_FAILED"; reason: BrownfieldBlockReason }
  | { type: "SCAN_COMPLETE" }
  | { type: "SCAN_BLOCKED"; reason: BrownfieldBlockReason }
  | { type: "TRY_ANOTHER_TIER" }
  | { type: "RATIFY_LAYOUT" }
  /**
   * Ratifying the manifest skips `findings_review` entirely when the scan
   * produced no fresh findings — an empty findings screen is noise, and the
   * report already states the zero.
   */
  | { type: "RATIFY_MANIFEST"; freshFindingCount: number }
  | { type: "RATIFY_FINDINGS" }
  | { type: "INSTALL_GATE" }
  | { type: "GO_BACK" };

/**
 * The transition table. Every edge the flow permits is listed here; anything
 * absent is rejected by `canTransition`, including `layout_ratify` ->
 * `scanning` (a scan is not re-runnable in place).
 */
function getValidTransitions(
  state: BrownfieldFlowState,
): BrownfieldFlowState[] {
  switch (state) {
    case "tier_pick":
      return ["uploading", "repo_entry"];
    case "uploading":
      return ["scanning", "blocked", "tier_pick"];
    case "repo_entry":
      return ["scanning", "blocked", "tier_pick"];
    case "scanning":
      return ["layout_ratify", "blocked"];
    case "blocked":
      // Recoverable: "try another tier" instead of a dead end.
      return ["tier_pick"];
    case "layout_ratify":
      // No edge back to "scanning" — the scan is a point-in-time artifact.
      return ["manifest_ratify", "tier_pick"];
    case "manifest_ratify":
      // "report" is the zero-fresh-findings shortcut past "findings_review".
      return ["findings_review", "report", "layout_ratify"];
    case "findings_review":
      return ["report", "manifest_ratify"];
    case "report":
      // Terminal-with-actions: the only way forward is an explicit install.
      return ["gate_install"];
    case "gate_install":
      return [];
    default:
      return [];
  }
}

export function canTransition(
  currentState: BrownfieldFlowState,
  nextState: BrownfieldFlowState,
): boolean {
  return getValidTransitions(currentState).includes(nextState);
}

/** Where "Back" lands, per state. A null target means Back is a no-op. */
function backTarget(
  currentState: BrownfieldFlowState,
): BrownfieldFlowState | null {
  switch (currentState) {
    case "uploading":
    case "repo_entry":
      return "tier_pick";
    case "blocked":
      return "tier_pick";
    case "layout_ratify":
      // NOT "scanning": re-entering the flow means starting a new run.
      return "tier_pick";
    case "manifest_ratify":
      return "layout_ratify";
    case "findings_review":
      return "manifest_ratify";
    // "tier_pick" is the flow's own entry (leaving it is the router's job),
    // "scanning" is blocking, and "report"/"gate_install" hold a point-in-time
    // artifact — Back does nothing in all four.
    default:
      return null;
  }
}

/** The state an event *asks* for, before the table is consulted. */
function candidateFor(
  currentState: BrownfieldFlowState,
  event: BrownfieldFlowEvent,
): BrownfieldFlowState {
  switch (event.type) {
    case "SELECT_TIER":
      // Tier B needs a repo reference first; A and C both start with a file.
      return event.tier === "clone" ? "repo_entry" : "uploading";
    case "SUBMIT_REPO_REF":
      return "scanning";
    case "UPLOAD_COMPLETE":
      return "scanning";
    case "UPLOAD_FAILED":
      return "blocked";
    case "SCAN_COMPLETE":
      return "layout_ratify";
    case "SCAN_BLOCKED":
      return "blocked";
    case "TRY_ANOTHER_TIER":
      return "tier_pick";
    case "RATIFY_LAYOUT":
      return "manifest_ratify";
    case "RATIFY_MANIFEST":
      return event.freshFindingCount > 0 ? "findings_review" : "report";
    case "RATIFY_FINDINGS":
      return "report";
    case "INSTALL_GATE":
      return "gate_install";
    case "GO_BACK":
      return backTarget(currentState) ?? currentState;
    default:
      return currentState;
  }
}

/**
 * Applies an event, but only through an edge the table permits. An event that
 * does not belong to the current screen is inert rather than teleporting the
 * user — this is what makes "`report` never auto-navigates" a property of the
 * machine instead of a convention every caller has to remember.
 */
export function transitionState(
  currentState: BrownfieldFlowState,
  event: BrownfieldFlowEvent,
): BrownfieldFlowState {
  const candidate = candidateFor(currentState, event);
  if (candidate === currentState) return currentState;
  return canTransition(currentState, candidate) ? candidate : currentState;
}

export function getInitialState(): BrownfieldFlowState {
  return "tier_pick";
}

/**
 * `gate_install` is the only state with no outgoing edge. `report` is
 * deliberately NOT terminal — it is terminal-with-actions, and callers must
 * keep rendering its actions rather than treating it as the end of the flow.
 */
export function isTerminalState(state: BrownfieldFlowState): boolean {
  return state === "gate_install";
}

/** States with work in flight — the views disable navigation while true. */
export function isBlockingState(state: BrownfieldFlowState): boolean {
  return state === "uploading" || state === "scanning";
}

export interface BrownfieldFlowStateMachine {
  transition(
    currentState: BrownfieldFlowState,
    event: BrownfieldFlowEvent,
  ): BrownfieldFlowState;
  canTransition(
    currentState: BrownfieldFlowState,
    nextState: BrownfieldFlowState,
  ): boolean;
  getInitialState(): BrownfieldFlowState;
  isTerminalState(state: BrownfieldFlowState): boolean;
  isBlockingState(state: BrownfieldFlowState): boolean;
}

export const brownfieldFlowMachine: BrownfieldFlowStateMachine = {
  transition: transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
};
