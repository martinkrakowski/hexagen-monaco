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
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
  ) => void;
  updateYaml: (yaml: string) => void;
  clear: () => void;
}

export const usePendingManifest = create<PendingManifestState>((set) => ({
  yaml: null,
  formValues: null,
  projectName: null,
  originPath: null,
  set: (
    yaml: string,
    formValues: ProjectSpec,
    projectName: string,
    originPath: string,
  ) => {
    set({ yaml, formValues, projectName, originPath });
  },
  updateYaml: (yaml: string) => {
    set({ yaml });
  },
  clear: () => {
    set({ yaml: null, formValues: null, projectName: null, originPath: null });
  },
}));
