"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { WelcomeStep } from "@/account-onboarding/components/WelcomeStep";
import { stepHref } from "@/account-onboarding/domain/onboarding-steps";
import { useAppSession } from "@/account-onboarding/useAppSession";
import { completeOnboardingAndGo } from "../complete-onboarding";

interface WelcomeClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
}

export function WelcomeClient({ router: injectedRouter }: WelcomeClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const { user } = useAppSession();
  const [busy, setBusy] = useState(false);

  const handleSkip = useCallback(() => {
    setBusy(true);
    // completeOnboardingAndGo always navigates; busy is never reset because
    // the screen is being left either way.
    void completeOnboardingAndGo(router);
  }, [router]);

  const displayName =
    user?.name ?? (user as { login?: string } | null)?.login ?? null;

  return (
    <WelcomeStep
      displayName={displayName}
      busy={busy}
      onContinue={() => router.push(stepHref("workspace"))}
      onSkip={handleSkip}
    />
  );
}
