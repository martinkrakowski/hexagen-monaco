"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceStep } from "@/account-onboarding/components/WorkspaceStep";
import { stepHref } from "@/account-onboarding/domain/onboarding-steps";
import { completeOnboardingAndGo } from "../complete-onboarding";

interface WorkspaceClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
}

export function WorkspaceClient({
  router: injectedRouter,
}: WorkspaceClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const [busy, setBusy] = useState(false);

  const handleSkip = useCallback(() => {
    setBusy(true);
    void completeOnboardingAndGo(router);
  }, [router]);

  return (
    <WorkspaceStep
      busy={busy}
      // "Just me" skips the org-flavored steps but NOT completion: the Done
      // summary still confirms the personal workspace from the server.
      onJustMe={() => router.push(stepHref("done"))}
      onCreateOrg={() => router.push(stepHref("org"))}
      onBack={() => router.push(stepHref("welcome"))}
      onSkip={handleSkip}
    />
  );
}
