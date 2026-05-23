"use client";

import { useState, useEffect } from "react";
import { LocalStorageTandemConfigAdapter } from "@hexagen/tandem-execution";

export const TANDEM_CONFIG_SENTINEL_KEY = "hexagen.tandem.configured";

/**
 * Writes the sentinel key to localStorage to record that the user has
 * successfully configured tandem mode at least once.
 * Phase 6 (Settings Wiring) calls this after persisting the first valid config.
 */
export function writeTandemConfigSentinel(): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TANDEM_CONFIG_SENTINEL_KEY, "1");
    }
  } catch {
    // Ignore storage errors — non-critical write
  }
}

/** Module-level guard: resets on hard reload, not on React re-renders. */
let recoveryShownThisSession = false;

export interface UseTandemLostConfigReturn {
  showRecoveryBanner: boolean;
  dismissRecoveryBanner: () => void;
}

/**
 * Detects when tandem config was previously saved but is now missing
 * (e.g. browser data was cleared). Shows a one-per-session recovery banner.
 */
export function useTandemLostConfig(): UseTandemLostConfigReturn {
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);

  useEffect(() => {
    // Only evaluate once per session
    if (recoveryShownThisSession) {
      return;
    }

    try {
      const sentinelPresent =
        typeof window !== "undefined" &&
        window.localStorage.getItem(TANDEM_CONFIG_SENTINEL_KEY) === "1";

      if (!sentinelPresent) {
        // User has never configured tandem — nothing to recover
        return;
      }

      const adapter = new LocalStorageTandemConfigAdapter();
      const result = adapter.read();

      // Config is "lost" if the sentinel is present but the stored config is
      // absent (the adapter returns DEFAULT_TANDEM_CONFIG when the item is
      // missing, so we check the key directly) or the read errored out.
      const configKeyMissing =
        result.success &&
        typeof window !== "undefined" &&
        window.localStorage.getItem("hexagen:tandem:config") === null;

      const configReadFailed = !result.success;

      if (configKeyMissing || configReadFailed) {
        recoveryShownThisSession = true;
        setShowRecoveryBanner(true);
      }
    } catch {
      // Silently ignore any storage access errors
    }
  }, []); // intentional: run once on mount

  const dismissRecoveryBanner = () => {
    setShowRecoveryBanner(false);
  };

  return { showRecoveryBanner, dismissRecoveryBanner };
}
