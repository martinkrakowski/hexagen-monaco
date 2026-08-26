/**
 * Active-tenant selection — a MODULE-LEVEL store, deliberately not React
 * context (P-U5).
 *
 * `wire.client.ts` constructs its adapter singletons once at module scope, so
 * `HttpSavedProjectsAdapter` / `CachedSavedProjectsAdapter` need a plain
 * GETTER they can call per request; a context value can never reach them.
 * React reads the same store through `useSyncExternalStore` (TenantContext),
 * so the provider and the adapters cannot disagree about which tenant is
 * active.
 *
 * `null` means the personal tenant. Anything else is an org id.
 *
 * Not built on `createPersistedStorage` (app/lib/persisted-state.ts) on
 * purpose: there, localStorage IS the state, and a throwing `setItem`
 * (private window) silently drops the change AND the listener notification.
 * Here the in-memory value is authoritative and localStorage is only a
 * best-effort mirror, so switching tenants keeps working when storage does
 * not.
 */

const STORAGE_KEY = "hexagen-active-tenant";

const listeners = new Set<() => void>();

function readPersisted(): string | null {
  // Every storage touch is try/caught: jsdom suites and private windows can
  // make the accessor itself throw. A failed read is "personal", never a
  // crash.
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && raw.length > 0 ? raw : null;
  } catch (cause) {
    // Observability only — the fallback IS the behavior (PR #666 review):
    // a per-viewer convenience whose authority is the server does not earn a
    // typed error channel, but a silent swallow hides real storage trouble.
    console.warn(
      "[tenant] reading the persisted tenant selection failed; using personal",
      cause,
    );
    return null;
  }
}

let activeTenantId: string | null = readPersisted();

/** Current tenant: `null` = personal, an org id otherwise. */
export function getActiveTenantId(): string | null {
  return activeTenantId;
}

export function setActiveTenantId(id: string | null): void {
  if (id === activeTenantId) return;
  activeTenantId = id;
  try {
    if (typeof window !== "undefined") {
      if (id === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, id);
    }
  } catch (cause) {
    // Best-effort persistence: the in-memory switch already happened, so the
    // session behaves correctly; only the reload-restore is lost. Warn so
    // the loss is at least visible (PR #666 review).
    console.warn(
      "[tenant] persisting the tenant selection failed; it will not survive a reload",
      cause,
    );
  }
  // Copy before iterating so a listener unsubscribing mid-notify is safe.
  for (const listener of [...listeners]) listener();
}

/** For `useSyncExternalStore`; returns the unsubscribe function. */
export function subscribeActiveTenant(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
