"use client";

import { useEffect, useState } from "react";
import type { SecretVaultPort } from "@hexagen/agentic-interaction";

/**
 * Safe client-side hook for accessing the SecretVaultPort.
 * Waits for the vault to be exposed to globalThis by the wire initialization.
 */
export function useSecretVault(): SecretVaultPort | null {
  const [vault, setVault] = useState<SecretVaultPort | null>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultPort = (globalThis as any).__hexagenVault as
      | SecretVaultPort
      | undefined;

    if (vaultPort) {
      setVault(vaultPort);
    } else {
      const timeout = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryVault = (globalThis as any).__hexagenVault as
          | SecretVaultPort
          | undefined;
        if (retryVault) {
          setVault(retryVault);
        }
      }, 100);

      return () => clearTimeout(timeout);
    }
  }, []);

  return vault;
}
