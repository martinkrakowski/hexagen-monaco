"use client";

import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";
import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import type { AuthSession, ProviderIdentity } from "@hexagen/external-integration";

interface ExternalIntegrationContextValue {
  isAuthenticated: boolean;
  identity: ProviderIdentity | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  session: AuthSession | null;
}

const ExternalIntegrationContext = createContext<ExternalIntegrationContextValue | null>(null);

const STORAGE_KEY = "hexagen-auth-session";

function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed && parsed.provider && parsed.identity && parsed.expiresAt) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function storeSession(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function ExternalIntegrationProvider({ children }: { children: ReactNode }) {
  // Defensive destructure: useSession() can briefly return undefined during
  // SSR or if SessionProvider hydration is in-flight on a special page
  // (e.g. /_not-found). Guarding here prevents a TypeError that would
  // collapse the entire provider tree and strand downstream consumers
  // (governance panel, editor) on their initial loading state.
  const sessionResult = useSession();
  const nextAuthSession = sessionResult?.data ?? null;
  const status = sessionResult?.status ?? "unauthenticated";
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    const stored = getStoredSession();
    if (stored) {
      setSession(stored);
    }
  }, []);

  const isAuthenticated = status === "authenticated" && !!nextAuthSession?.user;

  const identity: ProviderIdentity | null = nextAuthSession?.user
    ? {
        login: nextAuthSession.user.login || nextAuthSession.user.name || "",
        displayName: nextAuthSession.user.name || nextAuthSession.user.login || "",
        avatarUrl: nextAuthSession.user.image || "",
      }
    : null;

  const signIn = useCallback(async () => {
    await nextAuthSignIn("github", { callbackUrl: window.location.href });
  }, []);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: "/" });
    setSession(null);
    storeSession(null);
  }, []);

  const value: ExternalIntegrationContextValue = {
    isAuthenticated,
    identity,
    signIn,
    signOut,
    session,
  };

  return (
    <ExternalIntegrationContext.Provider value={value}>
      {children}
    </ExternalIntegrationContext.Provider>
  );
}

export function useExternalIntegration(): ExternalIntegrationContextValue {
  const context = useContext(ExternalIntegrationContext);
  if (!context) {
    throw new Error("useExternalIntegration must be used within ExternalIntegrationProvider");
  }
  return context;
}