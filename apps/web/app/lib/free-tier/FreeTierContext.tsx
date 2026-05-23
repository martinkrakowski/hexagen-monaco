"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { FreeTierModelModal } from "./FreeTierModelModal";
import { useCurrentModelName } from "./hooks/useCurrentModelName";
import { isFreeTierModel } from "../wire.client";
import { usePreferredLLM } from "./store/usePreferredLLM";

interface FreeTierContextValue {
  showFreeTierBadge: boolean;
  usingWebLLM: boolean;
  currentModelName: string | null;
  freeTierModal: ReactNode;
  openModal: () => void;
}

const FreeTierContext = createContext<FreeTierContextValue | null>(null);

export function useFreeTier(): FreeTierContextValue {
  const context = useContext(FreeTierContext);
  if (!context) {
    return {
      showFreeTierBadge: false,
      usingWebLLM: false,
      currentModelName: null,
      freeTierModal: null,
      openModal: () => {},
    };
  }
  return context;
}

export function FreeTierProvider({ children }: { children: ReactNode }) {
  const [freeTierModalOpen, setFreeTierModalOpen] = useState(false);
  const currentModelName = useCurrentModelName();
  const showFreeTierBadge = isFreeTierModel();
  const { preferredLocalModel } = usePreferredLLM();
  const usingWebLLM = preferredLocalModel !== null;

  const freeTierModal = (
    <FreeTierModelModal
      open={freeTierModalOpen}
      onOpenChange={setFreeTierModalOpen}
    />
  );

  const value = {
    showFreeTierBadge,
    usingWebLLM,
    currentModelName,
    freeTierModal,
    openModal: () => setFreeTierModalOpen(true),
  };

  return (
    <FreeTierContext.Provider value={value}>
      {children}
    </FreeTierContext.Provider>
  );
}
