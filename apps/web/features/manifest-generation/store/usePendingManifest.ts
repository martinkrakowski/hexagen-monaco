"use client";

import { create } from "zustand";
import { ProjectSpec } from "@hexagen/project-configuration";
import type { ProjectLayerTurn } from "@hexagen/shared";
// Type-only import (erased at compile time): no runtime coupling from the
// store to the streaming hook.
import type { StageValidationReport } from "../../../app/lib/useStagedGenerationStream";

/**
 * Provenance for a manifest whose spec text was DISTILLED from a live
 * planning session (Plan phase, Phase 3). Carried so the accept-save can
 * attach the FULL brainstorm transcript — not just the distilled spec — as
 * the new project's planning layer.
 */
export interface PendingSessionProvenance {
  /** The distilled spec text as confirmed by the user (guard: only attach the
   * transcript when the import flow actually consumed THIS text — an
   * abandoned finalize can't leak its session onto an unrelated import). */
  readonly specText: string;
  readonly turns: readonly ProjectLayerTurn[];
  readonly sourceProjectId: string;
  readonly sourceLayerId: string;
}

interface PendingManifestState {
  yaml: string | null;
  formValues: ProjectSpec | null;
  projectName: string | null;
  /**
   * The generation page that produced this manifest (e.g.
   * "/projects/new/ai" or "/projects/new/import/spec"). The accept screen's
   * Back/Regenerate actions return here — without it, import-flow users were
   * hard-routed to the prompt flow.
   */
  originPath: string | null;
  /**
   * The ORIGINAL text the user imported (spec/description), captured as a
   * planning layer when the accept screen saves. Carried in this store — not
   * sessionStorage — so it is set only by the flow that produced THIS manifest:
   * a stale key from an abandoned import can't attach wrong provenance to an
   * unrelated prompt-flow project, and the loose-spec conversion (which
   * overwrites sessionStorage with the converted JSON) can't replace the
   * user's own words.
   */
  originSpecText: string | null;
  /**
   * Live-session provenance (see PendingSessionProvenance). Set by the Plan
   * phase's finalize Confirm, DELIBERATELY not touched by `set()` — the
   * finalize hand-off runs BEFORE the import flow produces the manifest and
   * calls `set()`. Cleared with everything else by `clear()`, and guarded at
   * accept-save by an exact specText match.
   */
  originSession: PendingSessionProvenance | null;
  /**
   * The server pipeline's Stage-6 validation report for EXACTLY the `yaml`
   * held here, or null when the manifest never went through the staged
   * pipeline (hand-written manifest / legacy import). The accept view uses it
   * to (a) skip the client-side auto-fixer — the server already validated,
   * and where needed repaired, this YAML — and (b) render the server's
   * findings instead of re-deriving name-heuristic ones. Any yaml mutation
   * (`updateYaml`) invalidates it (see there).
   */
  validationReport: StageValidationReport | null;
  /**
   * True when the user continued with the EARLY Stage-5 manifest while the
   * Stage-6 review was still streaming (Part B-lite early-enable). The
   * generation stream is component-owned and dies with the generation page,
   * so no report will ever arrive for this manifest — the accept view shows
   * a "validation unavailable — re-run to review" note and falls back to the
   * client-side parse gate (validationReport is null in this state).
   */
  validationPending: boolean;
  setOriginSession: (session: PendingSessionProvenance | null) => void;
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
    originSpecText?: string | null,
    validationReport?: StageValidationReport | null,
    validationPending?: boolean,
  ) => void;
  updateYaml: (yaml: string) => void;
  clear: () => void;
}

export const usePendingManifest = create<PendingManifestState>((set) => ({
  yaml: null,
  formValues: null,
  projectName: null,
  originPath: null,
  originSpecText: null,
  originSession: null,
  validationReport: null,
  validationPending: false,
  setOriginSession: (session: PendingSessionProvenance | null) => {
    set({ originSession: session });
  },
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
    originSpecText?: string | null,
    validationReport?: StageValidationReport | null,
    validationPending?: boolean,
  ) => {
    set({
      yaml,
      formValues,
      projectName,
      originPath,
      originSpecText: originSpecText ?? null,
      validationReport: validationReport ?? null,
      validationPending: validationPending ?? false,
    });
  },
  updateYaml: (yaml: string) => {
    // Stale-report guard: the server report vouches only for the exact YAML
    // it was generated against — any edit (auto-fix drawer, future editors)
    // invalidates it, reverting the accept view to the live client-fixer
    // path. originSession is DELIBERATELY untouched, same contract as set()
    // (the finalize hand-off runs before the manifest lands here).
    // validationPending is also untouched: an edit doesn't change the fact
    // that this manifest's Stage-6 review never completed.
    set({ yaml, validationReport: null });
  },
  clear: () => {
    set({
      yaml: null,
      formValues: null,
      projectName: null,
      originPath: null,
      originSpecText: null,
      originSession: null,
      validationReport: null,
      validationPending: false,
    });
  },
}));
