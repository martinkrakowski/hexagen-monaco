/**
 * Brownfield flow — State/Actions contracts consumed by the flow hooks and
 * screens, mirroring `ModelSelectionFlow/types.ts`.
 *
 * The draft shapes below are intentionally local to this slice. BF-3.2 (the
 * API route) and BF-3.4 (draft persistence) own the wire contracts; wiring
 * this skeleton to them now would couple the flow to surfaces that do not
 * exist yet.
 */
import {
  transitionState,
  type BrownfieldBlockReason,
  type BrownfieldFlowEvent,
  type BrownfieldFlowState,
  type BrownfieldTier,
} from "./brownfield-flow-state-machine";

export type {
  BrownfieldBlockReason,
  BrownfieldFlowEvent,
  BrownfieldFlowState,
  BrownfieldTier,
};

/** How the conformance gate is handed over on the final screen (S7). */
export type BrownfieldGateInstallMode = "download-zip" | "open-pr";

/** One ratified workspace row from S3 — package root mapped to a context. */
export interface BrownfieldLayoutContextDraft {
  packageRoot: string;
  contextName: string;
  /** Layer name -> directories, prefilled from the probed aliases. */
  layerDirectories: Record<string, string[]>;
}

/** S3 output — the `contexts:` block of `layout.yaml`, as ratified. */
export interface BrownfieldLayoutDraft {
  contexts: BrownfieldLayoutContextDraft[];
}

/** One context row of the S4 bootstrap-answers collector. */
export interface BrownfieldManifestContextDraft {
  name: string;
  include: boolean;
  type: string;
  description: string;
  dependsOn: string[];
}

/** S4 output — the payload fields of `BootstrapAnswers`, as ratified. */
export interface BrownfieldManifestDraft {
  system: string;
  scope: string;
  architecture: string;
  contexts: BrownfieldManifestContextDraft[];
}

/**
 * One linter finding shown on S5. `rule` is an open string on the contract —
 * group dynamically, never against a hardcoded rule list.
 */
export interface BrownfieldFinding {
  rule: string;
  file: string;
  specifier: string;
  message: string;
}

/**
 * The flow's view state. Named `...ViewState` because the string union that
 * names the screens is itself `BrownfieldFlowState`; `state` below holds it.
 */
export interface BrownfieldFlowViewState {
  state: BrownfieldFlowState;
  projectName?: string | null;
  tier?: BrownfieldTier | null;
  repoUrl?: string | null;
  repoRef?: string | null;
  uploadedFileName?: string | null;
  /** Human-readable stage label streamed by the scan (S2). No fake percentages. */
  scanStageLabel?: string | null;
  blockReason?: BrownfieldBlockReason | null;
  layoutDraft?: BrownfieldLayoutDraft | null;
  manifestDraft?: BrownfieldManifestDraft | null;
  freshFindings?: BrownfieldFinding[] | null;
  /** Findings the user chose to seed into the debt ledger on S5. */
  baselinedFindingKeys?: string[] | null;
  gateInstallMode?: BrownfieldGateInstallMode | null;
  error?: string | null;
}

export interface BrownfieldFlowActions {
  transitionTo: (state: BrownfieldFlowState) => void;
  selectTier: (tier: BrownfieldTier) => void;
  submitRepoRef: (repoUrl: string, ref: string) => void;
  uploadCompleted: (fileName: string) => void;
  uploadFailed: (reason: BrownfieldBlockReason, message: string) => void;
  scanCompleted: (layoutDraft: BrownfieldLayoutDraft) => void;
  scanBlocked: (reason: BrownfieldBlockReason, message: string) => void;
  /** Recovery out of `blocked` — returns to the tier picker for a new run. */
  tryAnotherTier: () => void;
  ratifyLayout: (layoutDraft: BrownfieldLayoutDraft) => void;
  ratifyManifest: (
    manifestDraft: BrownfieldManifestDraft,
    freshFindings: BrownfieldFinding[],
  ) => void;
  ratifyFindings: (baselinedFindingKeys: string[]) => void;
  installGate: (mode: BrownfieldGateInstallMode) => void;
  goBack: () => void;
  setError: (message: string) => void;
  clearError: () => void;
}

/**
 * Thin wrapper over the machine so screens depend on this module rather than
 * reaching into the machine directly.
 */
export function deriveStateFromEvent(
  currentState: BrownfieldFlowState,
  event: BrownfieldFlowEvent,
): BrownfieldFlowState {
  return transitionState(currentState, event);
}
