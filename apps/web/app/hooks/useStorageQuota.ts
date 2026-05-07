"use client";

import { useSyncExternalStore, useCallback } from "react";
import type { StorageQuotaStatus } from "@hexagen/web-driver";
import { getStorageQuotaMonitor } from "@hexagen/web-driver";

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const serverStatus: StorageQuotaStatus = {
  usedBytes: 0,
  totalBytes: 5 * 1024 * 1024,
  usagePercent: 0,
  isNearQuota: false,
  isCritical: false,
};

function subscribe(callback: () => void): () => void {
  const monitor = getStorageQuotaMonitor();
  return monitor.onStatusChange(() => {
    callback();
  });
}

function getSnapshot(): StorageQuotaStatus {
  return getStorageQuotaMonitor().getStatus();
}

function getServerSnapshot(): StorageQuotaStatus {
  return serverStatus;
}

export function useStorageQuota() {
  const status = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const trimOldSessions = useCallback((maxAgeMs?: number): number => {
    return getStorageQuotaMonitor().trimOldWorkspaceSessions(
      maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    );
  }, []);

  const lruProjectIds = getStorageQuotaMonitor().getLruSavedProjectIds();

  return {
    ...status,
    trimOldSessions,
    lruProjectIds,
  };
}
