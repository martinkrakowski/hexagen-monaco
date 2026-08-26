"use client";

import { ArrowLeft, Building2, User } from "lucide-react";
import { Button } from "@hexagen/ui";
import { OnboardingStepShell } from "./OnboardingStepShell";

interface WorkspaceStepProps {
  readonly busy?: boolean;
  /** "Just me" — personal workspace, skip straight to the Done summary. */
  readonly onJustMe: () => void;
  /** "Create an organization" — continue to the org step. */
  readonly onCreateOrg: () => void;
  readonly onBack: () => void;
  /** Skipping counts as completing onboarding (D-U4). */
  readonly onSkip: () => void;
}

/**
 * Step 2 — choose where work lives: a personal workspace or a new
 * organization. Two card choices (CreationPathCard's structure, loosely);
 * the container owns what each choice routes to.
 */
export function WorkspaceStep({
  busy = false,
  onJustMe,
  onCreateOrg,
  onBack,
  onSkip,
}: WorkspaceStepProps) {
  return (
    <OnboardingStepShell
      currentStep={2}
      title="Where does your work live?"
      description="You can always create an organization later."
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="secondary" onClick={onSkip} disabled={busy}>
            Skip setup
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onJustMe}
          disabled={busy}
          className="group bg-card border border-card-border rounded-lg p-6 text-left transition-all hover:border-success/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          <div className="w-10 h-10 rounded-md flex items-center justify-center mb-4 bg-success/10 group-hover:bg-success/20 transition-colors">
            <User className="h-5 w-5 text-success" aria-hidden />
          </div>
          <h3 className="font-bold text-lg mb-2 group-hover:text-success transition-colors">
            Just me
          </h3>
          <p className="text-sm text-muted-foreground">
            Work in your personal workspace. Projects belong to your account
            alone.
          </p>
        </button>

        <button
          type="button"
          onClick={onCreateOrg}
          disabled={busy}
          className="group bg-card border border-primary/30 rounded-lg p-6 text-left transition-all hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          <div className="w-10 h-10 rounded-md flex items-center justify-center mb-4 bg-primary/15 group-hover:bg-primary/25 transition-colors">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <h3 className="font-bold text-lg mb-2 group-hover:text-primary transition-colors">
            Create an organization
          </h3>
          <p className="text-sm text-muted-foreground">
            Share projects with teammates. Add teams and invite people by GitHub
            handle.
          </p>
        </button>
      </div>
    </OnboardingStepShell>
  );
}
