"use client";

import { create } from "zustand";
import { ProjectSpec } from "@hexagen/project-configuration";
import type { ProjectLayerTurn } from "@hexagen/shared";

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
  setOriginSession: (session: PendingSessionProvenance | null) => void;
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
    originSpecText?: string | null,
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
  setOriginSession: (session: PendingSessionProvenance | null) => {
    set({ originSession: session });
  },
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
    originSpecText?: string | null,
  ) => {
    set({
      yaml,
      formValues,
      projectName,
      originPath,
      originSpecText: originSpecText ?? null,
    });
  },
  updateYaml: (yaml: string) => {
    set({ yaml });
  },
  clear: () => {
    set({
      yaml: null,
      formValues: null,
      projectName: null,
      originPath: null,
      originSpecText: null,
      originSession: null,
    });
  },
}));
