import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DomainModelId } from "@hexagen/local-llm";

interface PreferredLLMState {
  preferredLocalModel: DomainModelId | null;
  setPreferredLocalModel: (modelId: DomainModelId | null) => void;
  clearPreferredLocalModel: () => void;
}

export const usePreferredLLM = create<PreferredLLMState>()(
  persist(
    (set) => ({
      preferredLocalModel: null,
      setPreferredLocalModel: (modelId) =>
        set({ preferredLocalModel: modelId }),
      clearPreferredLocalModel: () => set({ preferredLocalModel: null }),
    }),
    {
      name: "preferred-llm-storage",
    },
  ),
);
