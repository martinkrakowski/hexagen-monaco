"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Result } from "@hexagen/shared";
import type { OrgMembershipSummary } from "../../lib/platform";
import {
  getActiveTenantId,
  setActiveTenantId,
  subscribeActiveTenant,
} from "../lib/active-tenant";
import {
  HttpOrgsAdapter,
  type OrgsGatewayError,
} from "../lib/adapters/http-orgs.adapter";

/**
 * React face of the tenant switcher (P-U5).
 *
 * The SELECTION itself lives in the module-level store
 * (app/lib/active-tenant.ts), because the wire.client adapter singletons read
 * it through a plain getter. This provider mirrors it into React via
 * `useSyncExternalStore`, so components and adapters can never disagree, and
 * adds the org MEMBERSHIP list on top.
 */

/** The narrow orgs surface the provider needs — injectable for tests. */
export interface TenantOrgsPort {
  listOrgs(): Promise<Result<OrgMembershipSummary[], OrgsGatewayError>>;
}

export interface TenantContextValue {
  /** `null` = personal tenant; otherwise an org id from `orgs`. */
  activeTenantId: string | null;
  orgs: OrgMembershipSummary[];
  selectTenant: (id: string | null) => void;
  /** Re-fetch the membership list (also runs on mount and window focus). */
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/** SSR snapshot: the server never knows a browser-persisted selection. */
const getServerTenantSnapshot = (): string | null => null;

export function TenantProvider({
  children,
  orgsPort,
}: {
  children: ReactNode;
  orgsPort?: TenantOrgsPort;
}) {
  const activeTenantId = useSyncExternalStore(
    subscribeActiveTenant,
    getActiveTenantId,
    getServerTenantSnapshot,
  );
  const [orgs, setOrgs] = useState<OrgMembershipSummary[]>([]);
  // One adapter per provider instance; a prop-injected port wins (tests).
  const portRef = useRef<TenantOrgsPort | null>(orgsPort ?? null);
  if (portRef.current === null) portRef.current = new HttpOrgsAdapter();
  const port = portRef.current;

  const refresh = useCallback(async (): Promise<void> => {
    const result = await port.listOrgs();
    // A FAILED fetch (network, signed-out 401) keeps both the current list
    // and the current selection: without a trustworthy membership list there
    // is no basis for resetting anything, and the server re-checks
    // membership on every request anyway.
    if (!result.success) return;
    setOrgs(result.value);
    // Stale-selection gate: a persisted org the fetched list does not
    // contain (membership revoked elsewhere, org deleted — JWTs never learn
    // that) resets to personal. Never render another tenant's UI on a stale
    // selection.
    const active = getActiveTenantId();
    if (active !== null && !result.value.some((org) => org.id === active)) {
      console.warn(
        `[tenant] persisted tenant ${active} is not in the caller's org list; resetting to personal`,
      );
      setActiveTenantId(null);
    }
  }, [port]);

  useEffect(() => {
    void refresh();
    // Refresh on window focus: membership can change in another tab or by
    // another owner while this tab sits idle.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const selectTenant = useCallback((id: string | null) => {
    setActiveTenantId(id);
  }, []);

  const value = useMemo<TenantContextValue>(
    () => ({ activeTenantId, orgs, selectTenant, refresh }),
    [activeTenantId, orgs, selectTenant, refresh],
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within TenantProvider");
  }
  return context;
}

/**
 * Provider-tolerant variant for chrome that is ALSO mounted outside
 * WorkspaceChrome (the wizard's ProjectWorkspace renders its own Header):
 * absence of the provider means "no tenant switcher here", not a crash.
 */
export function useTenantOptional(): TenantContextValue | null {
  return useContext(TenantContext);
}
