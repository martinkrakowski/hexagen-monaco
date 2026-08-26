"use client";

import { signIn as nextAuthSignIn, useSession } from "next-auth/react";

/**
 * App-level session facade for the account-onboarding slice.
 *
 * Deliberately separate from `ExternalIntegrationContext`: that context's
 * `signIn` and every consumer label mean "authorize GitHub PUBLISH" (it
 * returns to `window.location.href` and its copy says so). This hook means
 * "sign in to the app" — accounts, orgs, saved work. Same GitHub OAuth under
 * the hood today; the concepts stay separate so a future scope split (the
 * flagged owner decision) touches auth config, not every call site.
 *
 * The defensive destructure mirrors `ExternalIntegrationContext`: `useSession`
 * can be mid-hydration on error routes, so absence degrades to
 * "unauthenticated" rather than throwing.
 */
export function useAppSession() {
  const sessionResult = useSession();
  const status = sessionResult?.status ?? "unauthenticated";
  const user = sessionResult?.data?.user ?? null;
  return { status, user } as const;
}

/** Starts app sign-in and returns to `callbackUrl` after the OAuth round trip. */
export function signInToApp(callbackUrl: string): Promise<unknown> {
  return nextAuthSignIn("github", { callbackUrl });
}
