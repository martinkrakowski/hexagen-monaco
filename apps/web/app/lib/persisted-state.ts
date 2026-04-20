/**
 * Generic SSR-safe localStorage accessor with schema-aware validation.
 *
 * Returns a typed get/set pair that:
 *   - No-ops during SSR (typeof window === "undefined")
 *   - Returns null for unparseable / schema-invalid stored values
 *   - Swallows quota errors (rare, but localStorage.setItem can throw
 *     in private-browsing modes with storage disabled)
 *
 * Replaces per-context duplicates of the same read/write/validate
 * pattern that previously lived in ActiveWorkspaceContext and
 * ExternalIntegrationContext.
 */
export interface PersistedStorage<T> {
  /** Read the current value; null if absent or invalid. */
  read: () => T | null;
  /** Write a value, or clear storage when null. */
  write: (value: T | null) => void;
}

export function createPersistedStorage<T>(
  storageKey: string,
  isValid: (candidate: unknown) => candidate is T,
): PersistedStorage<T> {
  return {
    read(): T | null {
      if (typeof window === "undefined") return null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isValid(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    write(value: T | null): void {
      if (typeof window === "undefined") return;
      try {
        if (value) {
          localStorage.setItem(storageKey, JSON.stringify(value));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        // Swallow quota / private-mode errors — persistence is best-effort.
      }
    },
  };
}
