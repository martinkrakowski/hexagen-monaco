export interface StorageQuotaStatus {
  usedBytes: number;
  totalBytes: number;
  usagePercent: number;
  isNearQuota: boolean;
  isCritical: boolean;
}

export interface StorageQuotaMonitor {
  getStatus(): StorageQuotaStatus;
  onQuotaWarning(callback: (status: StorageQuotaStatus) => void): () => void;
  trimOldWorkspaceSessions(maxAgeMs?: number): number;
  getLruSavedProjectIds(): string[];
}

const TOTAL_BYTES = 5 * 1024 * 1024;
const NEAR_QUOTA_THRESHOLD = 0.8;
const CRITICAL_QUOTA_THRESHOLD = 0.95;
const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";
const SAVED_PROJECTS_KEY = "hexagen-saved-projects";
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function computeUsedBytes(): number {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    total += new Blob([key]).size + new Blob([value]).size;
  }
  return total;
}

export function createStorageQuotaMonitor(): StorageQuotaMonitor {
  const listeners = new Set<(status: StorageQuotaStatus) => void>();
  let cachedStatus: StorageQuotaStatus | null = null;

  function computeStatus(): StorageQuotaStatus {
    const usedBytes = computeUsedBytes();
    const usagePercent = (usedBytes / TOTAL_BYTES) * 100;
    return {
      usedBytes,
      totalBytes: TOTAL_BYTES,
      usagePercent,
      isNearQuota: usagePercent >= NEAR_QUOTA_THRESHOLD * 100,
      isCritical: usagePercent >= CRITICAL_QUOTA_THRESHOLD * 100,
    };
  }

  function getStatus(): StorageQuotaStatus {
    if (!cachedStatus) {
      cachedStatus = computeStatus();
    }
    return cachedStatus;
  }

  function notifyListeners(status: StorageQuotaStatus): void {
    if (status.isNearQuota) {
      for (const cb of listeners) {
        cb(status);
      }
    }
  }

  function invalidateAndNotify(): void {
    cachedStatus = null;
    const status = getStatus();
    notifyListeners(status);
  }

  function onQuotaWarning(
    callback: (status: StorageQuotaStatus) => void,
  ): () => void {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  function trimOldWorkspaceSessions(
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  ): number {
    const cutoff = Date.now() - maxAgeMs;
    let trimmed = 0;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(WORKSPACE_KEY_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (raw === null) continue;

      try {
        const parsed = JSON.parse(raw) as { updatedAt?: number };
        if (typeof parsed.updatedAt === "number" && parsed.updatedAt < cutoff) {
          keysToRemove.push(key);
        }
      } catch {
        continue;
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
      trimmed++;
    }

    if (trimmed > 0) {
      invalidateAndNotify();
    }

    return trimmed;
  }

  function getLruSavedProjectIds(): string[] {
    const raw = localStorage.getItem(SAVED_PROJECTS_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Array<{
        id: string;
        updatedAt: number;
      }>;
      if (!Array.isArray(parsed)) return [];

      return [...parsed]
        .filter(
          (p) => typeof p.id === "string" && typeof p.updatedAt === "number",
        )
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .map((p) => p.id);
    } catch {
      return [];
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", invalidateAndNotify);
  }

  return {
    getStatus,
    onQuotaWarning,
    trimOldWorkspaceSessions,
    getLruSavedProjectIds,
  };
}

let _instance: StorageQuotaMonitor | null = null;

export function getStorageQuotaMonitor(): StorageQuotaMonitor {
  if (!_instance) {
    _instance = createStorageQuotaMonitor();
  }
  return _instance;
}
