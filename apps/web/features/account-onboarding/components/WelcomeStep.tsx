"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@hexagen/ui";
import { OnboardingStepShell } from "./OnboardingStepShell";

interface WelcomeStepProps {
  /** Display name or GitHub login — whichever the session carries. */
  readonly displayName?: string | null;
  readonly busy?: boolean;
  readonly onContinue: () => void;
  /** Skipping counts as completing onboarding (D-U4). */
  readonly onSkip: () => void;
}

/**
 * Step 1 — greets the freshly signed-in user and frames what the wizard sets
 * up. Presentational: the container owns navigation and the skip-completion
 * POST.
 */
export function WelcomeStep({
  displayName,
  busy = false,
  onContinue,
  onSkip,
}: WelcomeStepProps) {
  const greeting = displayName ? `Welcome, ${displayName}` : "Welcome";

  return (
    <OnboardingStepShell
      currentStep={1}
      title={greeting}
      description="Your account is ready. A couple of optional steps set up where your work lives."
      footer={
        <>
          <Button variant="secondary" onClick={onSkip} disabled={busy}>
            Skip setup
          </Button>
          <Button onClick={onContinue} disabled={busy}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>
          This short setup walks through your workspace: work alone in a
          personal workspace, or create an organization with teams and invite
          collaborators by GitHub handle.
        </p>
        <p>
          Everything here is optional and can be done later from the workspace —
          skipping never locks anything away.
        </p>
      </div>
    </OnboardingStepShell>
  );
}
