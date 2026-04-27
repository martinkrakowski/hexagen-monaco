"use client";

import { useEffect, useState } from "react";
import type { UserSecretVaultPort } from "@hexagen/web-driver";

/**
 * Safe client-side hook for accessing the UserSecretVaultPort.
 * Waits for the vault to be exposed to globalThis by the wire initialization.
 */
export function useSecretVault(): UserSecretVaultPort | null {
  const [vault, setVault] = useState<UserSecretVaultPort | null>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultPort = (globalThis as any).__hexagenVault as
      | UserSecretVaultPort
      | undefined;

    if (vaultPort) {
      setVault(vaultPort);
    } else {
      const timeout = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryVault = (globalThis as any).__hexagenVault as
          | UserSecretVaultPort
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
