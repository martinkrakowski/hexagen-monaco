"use client";

import { ArrowRight } from "lucide-react";
import { Alert, Button, Card, Spinner } from "@hexagen/ui";
import { OnboardingStepShell } from "./OnboardingStepShell";

/** Server-derived summary of what onboarding actually created. */
export interface OnboardingSummary {
  /** null = personal workspace, no organization was created. */
  readonly org: {
    readonly name: string;
    readonly slug: string;
    readonly memberCount: number;
    readonly pendingInviteCount: number;
  } | null;
}

interface DoneStepProps {
  /**
   * undefined while the container is still fetching. The summary is
   * RE-DERIVED from the server by the container (GET /api/orgs + the members
   * listing) — never trusted from carried wizard state.
   */
  readonly summary?: OnboardingSummary;
  readonly busy?: boolean;
  readonly validationMessage?: string | null;
  readonly onGoToWorkspace: () => void;
}

/**
 * Step 6 — the closing summary. Whatever happens to the summary fetch, the
 * "Go to your workspace" button stays live: this step must never strand a
 * user whose account is already fully set up.
 */
export function DoneStep({
  summary,
  busy = false,
  validationMessage = null,
  onGoToWorkspace,
}: DoneStepProps) {
  return (
    <OnboardingStepShell
      currentStep={6}
      title="You're all set"
      footer={
        <Button onClick={onGoToWorkspace} disabled={busy}>
          Go to your workspace
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      }
    >
      <div className="space-y-4">
        {validationMessage ? (
          <Alert tone="warning">{validationMessage}</Alert>
        ) : summary === undefined ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : summary.org ? (
          <Card className="p-6 text-left">
            <h3 className="font-semibold mb-2">
              {summary.org.name}
              <span className="text-muted-foreground font-normal">
                {" "}
                · {summary.org.slug}
              </span>
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                {summary.org.memberCount}{" "}
                {summary.org.memberCount === 1 ? "member" : "members"}
              </li>
              <li>
                {summary.org.pendingInviteCount} pending{" "}
                {summary.org.pendingInviteCount === 1 ? "invite" : "invites"}
              </li>
            </ul>
          </Card>
        ) : (
          <Card className="p-6 text-left">
            <h3 className="font-semibold mb-2">Personal workspace</h3>
            <p className="text-sm text-muted-foreground">
              Your projects belong to your account. Create an organization any
              time to share them.
            </p>
          </Card>
        )}
      </div>
    </OnboardingStepShell>
  );
}
