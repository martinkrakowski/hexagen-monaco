"use client";

import { create } from "zustand";
import { ProjectSpec } from "@hexagen/project-configuration";

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
    });
  },
}));
