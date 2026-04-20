"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useSession, signIn as nextAuthSignIn } from "next-auth/react";

export interface ExternalIntegrationContextValue {
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
}

const ExternalIntegrationContext =
  createContext<ExternalIntegrationContextValue | null>(null);

export function ExternalIntegrationProvider({
  children,
}: {
  children: ReactNode;
}) {
  // Defensive destructure: useSession() can briefly return undefined
  // during SSR or if SessionProvider hydration is in-flight on a
  // special page (e.g. /_not-found). Guarding here prevents a
  // TypeError that would collapse the entire provider tree.
  const sessionResult = useSession();
  const nextAuthSession = sessionResult?.data ?? null;
  const status = sessionResult?.status ?? "unauthenticated";

  const isAuthenticated = status === "authenticated" && !!nextAuthSession?.user;

  const signIn = useCallback(async () => {
    await nextAuthSignIn("github", { callbackUrl: window.location.href });
  }, []);

  // Memoized so consumers only re-render when auth status actually changes.
  const value = useMemo<ExternalIntegrationContextValue>(
    () => ({ isAuthenticated, signIn }),
    [isAuthenticated, signIn],
  );

  return (
    <ExternalIntegrationContext.Provider value={value}>
      {children}
    </ExternalIntegrationContext.Provider>
  );
}

export function useExternalIntegration(): ExternalIntegrationContextValue {
  const context = useContext(ExternalIntegrationContext);
  if (!context) {
    throw new Error(
      "useExternalIntegration must be used within ExternalIntegrationProvider",
    );
  }
  return context;
}
