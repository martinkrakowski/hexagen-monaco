"use client";

import { create } from "zustand";
import { ProjectSpec } from "@hexagen/project-configuration";

interface PendingManifestState {
  yaml: string | null;
  formValues: ProjectSpec | null;
  projectName: string | null;
  set: (yaml: string, formValues: ProjectSpec, projectName: string) => void;
  clear: () => void;
}

export const usePendingManifest = create<PendingManifestState>((set) => ({
  yaml: null,
  formValues: null,
  projectName: null,
  set: (yaml: string, formValues: ProjectSpec, projectName: string) => {
    set({ yaml, formValues, projectName });
  },
  clear: () => {
    set({ yaml: null, formValues: null, projectName: null });
  },
}));
