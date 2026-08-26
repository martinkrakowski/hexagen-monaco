"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, FormField, Input } from "@hexagen/ui";
import { ORG_SLUG_PATTERN } from "@/lib/adapters/http-orgs.adapter";
import { OnboardingStepShell } from "./OnboardingStepShell";
import { useNameSlug } from "./useNameSlug";

interface TeamStepProps {
  readonly busy?: boolean;
  /** Server-surfaced failure (e.g. a duplicate team slug within the org). */
  readonly validationMessage?: string | null;
  readonly onCreate: (name: string, slug: string) => void;
  readonly onBack: () => void;
  /** Continue WITHOUT a team — prominent, because a first team is optional. */
  readonly onSkip: () => void;
  /**
   * The WIZARD-WIDE "Skip setup" every intermediate step carries (D-U4:
   * complete onboarding and leave). Distinct from `onSkip`, which only skips
   * THIS step — losing this action made the team step the one screen with no
   * way out of the wizard (review flag on #667).
   */
  readonly onSkipSetup: () => void;
}

/**
 * Step 4 — an optional first team inside the new organization. Same
 * name+slug idiom as OrgStep (teams routes share the slug rule); Skip is the
 * prominent default action because most orgs start without teams.
 */
export function TeamStep({
  busy = false,
  validationMessage = null,
  onCreate,
  onBack,
  onSkip,
  onSkipSetup,
}: TeamStepProps) {
  const { name, slug, handleNameChange, handleSlugChange } = useNameSlug();

  const trimmedName = name.trim();
  const slugValid = ORG_SLUG_PATTERN.test(slug);
  const slugShapeMessage =
    slug.length > 0 && !slugValid
      ? "Use 2–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit."
      : undefined;
  const canCreate = trimmedName.length > 0 && slugValid && !busy;

  const handleSubmit = () => {
    if (!canCreate) return;
    onCreate(trimmedName, slug);
  };

  return (
    <OnboardingStepShell
      currentStep={4}
      title="Add a first team?"
      description="Optional — teams group members inside your organization. You can add them any time."
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="secondary" onClick={onSkipSetup} disabled={busy}>
            Skip setup
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            disabled={!canCreate}
          >
            Create team
          </Button>
          <Button onClick={onSkip} disabled={busy}>
            Skip for now
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <FormField label="Team name" htmlFor="team-name">
          <Input
            id="team-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Platform"
            disabled={busy}
            autoFocus
          />
        </FormField>

        <FormField
          label="Slug"
          htmlFor="team-slug"
          hint="Suggested from the name until you edit it."
          validationMessage={slugShapeMessage ?? validationMessage ?? undefined}
        >
          <Input
            id="team-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="platform"
            disabled={busy}
          />
        </FormField>
      </div>
    </OnboardingStepShell>
  );
}
