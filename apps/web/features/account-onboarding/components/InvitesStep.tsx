"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, UserPlus } from "lucide-react";
import { Avatar, Button, FormField, Input, Label } from "@hexagen/ui";
import type { OrgInviteReceipt } from "@/lib/adapters/http-orgs.adapter";
import { OnboardingStepShell } from "./OnboardingStepShell";

/**
 * The one status line an invite entry may carry. A single constant, used for
 * EVERY entry: the anti-enumeration rule (D-A4) extends to UI copy — the
 * server answers 202 whether or not the handle has an account here, and this
 * screen must not re-introduce the distinction the API deliberately erased.
 * The sibling test renders two different handles and asserts their status
 * copy is character-identical.
 */
export const INVITE_STATUS_COPY = "Invited — joins at next sign-in";

interface InvitesStepProps {
  readonly busy?: boolean;
  readonly validationMessage?: string | null;
  /** 202 receipts, in invite order — the container owns this list. */
  readonly invites: readonly OrgInviteReceipt[];
  readonly onInvite: (githubLogin: string, role: "owner" | "member") => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  /** Skipping counts as completing onboarding (D-U4). */
  readonly onSkip: () => void;
}

/**
 * Step 5 — invite collaborators by GitHub handle. Every submission yields an
 * invite receipt (never a membership — see OrgInviteReceipt); entries render
 * with uniform copy regardless of whether the handle has an account.
 */
export function InvitesStep({
  busy = false,
  validationMessage = null,
  invites,
  onInvite,
  onBack,
  onContinue,
  onSkip,
}: InvitesStepProps) {
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");

  const trimmed = handle.trim();
  const canInvite = trimmed.length > 0 && !busy;

  const handleInvite = () => {
    if (!canInvite) return;
    onInvite(trimmed, role);
    setHandle("");
  };

  return (
    <OnboardingStepShell
      currentStep={5}
      title="Invite your teammates"
      description="Invites are by GitHub handle. Each person joins the organization the next time they sign in."
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
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
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            label="GitHub handle"
            htmlFor="invite-handle"
            className="flex-1 min-w-48"
            validationMessage={validationMessage ?? undefined}
          >
            <Input
              id="invite-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInvite();
              }}
              placeholder="octocat"
              disabled={busy}
              autoFocus
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">Role</Label>
            {/* Native select — packages/ui has no Select primitive, and this
                flow does not justify building one. */}
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "owner" | "member")}
              disabled={busy}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </div>

          <Button
            variant="secondary"
            onClick={handleInvite}
            disabled={!canInvite}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Invite
          </Button>
        </div>

        {invites.length > 0 ? (
          <ul className="space-y-3" aria-label="Pending invites">
            {invites.map((invite) => (
              <li
                key={`${invite.githubLogin}:${invite.expiresAt}`}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <Avatar name={invite.githubLogin} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {invite.githubLogin}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {invite.role}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {INVITE_STATUS_COPY} (invite expires{" "}
                    {new Date(invite.expiresAt).toLocaleDateString()})
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </OnboardingStepShell>
  );
}
