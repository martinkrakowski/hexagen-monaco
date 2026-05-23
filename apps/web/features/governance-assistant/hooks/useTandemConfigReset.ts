"use client";

import { useState, useCallback } from "react";
import { LocalStorageTandemConfigAdapter } from "@hexagen/tandem-execution";
import { TANDEM_CONFIG_SENTINEL_KEY } from "./useTandemLostConfig";

export interface UseTandemConfigResetOptions {
  onResetComplete?: () => void;
}

export interface UseTandemConfigResetReturn {
  isResetting: boolean;
  confirmReset: () => void;
  executeReset: () => void;
  cancelReset: () => void;
  showConfirmDialog: boolean;
}

/**
 * Provides logic for resetting the tandem configuration.
 * Phase 6 will wire this into the Settings panel UI.
 */
export function useTandemConfigReset(
  options: UseTandemConfigResetOptions = {},
): UseTandemConfigResetReturn {
  const { onResetComplete } = options;

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const confirmReset = useCallback(() => {
    setShowConfirmDialog(true);
  }, []);

  const cancelReset = useCallback(() => {
    setShowConfirmDialog(false);
  }, []);

  const executeReset = useCallback(() => {
    setIsResetting(true);
    try {
      const adapter = new LocalStorageTandemConfigAdapter();
      adapter.reset();

      // Remove the sentinel so lost-config detection won't fire after reset
      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(TANDEM_CONFIG_SENTINEL_KEY);
        }
      } catch {
        // Ignore storage errors — non-critical
      }

      setShowConfirmDialog(false);
      onResetComplete?.();
    } finally {
      setIsResetting(false);
    }
  }, [onResetComplete]);

  return {
    isResetting,
    confirmReset,
    executeReset,
    cancelReset,
    showConfirmDialog,
  };
}
