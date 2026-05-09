"use client";

import { create } from "zustand";

interface ModelSelectionIntentState {
  autoGenerate: boolean;
  setAutoGenerate: (value: boolean) => void;
  clear: () => void;
}

export const useModelSelectionIntent = create<ModelSelectionIntentState>(
  (set) => ({
    autoGenerate: false,
    setAutoGenerate: (value: boolean) => set({ autoGenerate: value }),
    clear: () => set({ autoGenerate: false }),
  }),
);
