"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginScreen } from "@/account-onboarding/LoginScreen";
import { signInToApp, useAppSession } from "@/account-onboarding/useAppSession";

/**
 * Only same-origin relative paths may be followed after sign-in. The
 * middleware always builds `callbackUrl` from a pathname, so a legitimate
 * value starts with a single "/"; anything else ("//evil.host", an absolute
 * URL, garbage) is an open-redirect attempt and falls back to the front door.
 */
export function safeCallbackUrl(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/projects/new";
}

interface LoginClientProps {
  readonly router?: { replace: (url: string) => void };
}

export function LoginClient({ router: injectedRouter }: LoginClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const { status } = useAppSession();
  const [busy, setBusy] = useState(false);

  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));

  // A signed-in visitor has no business on the login screen: bounce to where
  // they were headed. `replace`, not `push` — Back must not return here.
  useEffect(() => {
    if (status === "authenticated") router.replace(callbackUrl);
  }, [status, callbackUrl, router]);

  if (status === "authenticated") return null;

  return (
    <LoginScreen
      busy={busy}
      onSignIn={() => {
        setBusy(true);
        signInToApp(callbackUrl);
      }}
    />
  );
}
