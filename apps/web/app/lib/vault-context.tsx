"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SecretVaultPort } from "@hexagen/agentic-interaction";
import { getSecretVault } from "./wire.js";

const SecretVaultContext = createContext<SecretVaultPort | null>(null);

export function SecretVaultProvider({ children }: { children: ReactNode }) {
  // The vault is a singleton from wire.ts
  const vault = getSecretVault();
  return (
    <SecretVaultContext.Provider value={vault}>
      {children}
    </SecretVaultContext.Provider>
  );
}

export function useSecretVault(): SecretVaultPort {
  const context = useContext(SecretVaultContext);
  if (!context) {
    throw new Error("useSecretVault must be used within a SecretVaultProvider");
  }
  return context;
}
