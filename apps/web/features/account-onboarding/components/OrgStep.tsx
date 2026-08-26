"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, FormField, Input } from "@hexagen/ui";
import { ORG_SLUG_PATTERN } from "@/lib/adapters/http-orgs.adapter";
import { OnboardingStepShell } from "./OnboardingStepShell";
import { useNameSlug } from "./useNameSlug";

interface OrgStepProps {
  readonly busy?: boolean;
  /**
   * Server-surfaced failure (e.g. the duplicate-slug 409: "taken — pick
   * another"). Local shape problems render inline on the slug field instead.
   */
  readonly validationMessage?: string | null;
  readonly onCreate: (name: string, slug: string) => void;
  readonly onBack: () => void;
  /** Skipping counts as completing onboarding (D-U4). */
  readonly onSkip: () => void;
}

/**
 * Step 3 — create the organization. The slug is auto-suggested from the name
 * until the user edits it manually (useNameSlug). `ORG_SLUG_PATTERN` refuses
 * obvious garbage before a round-trip, but the server's UNIQUE index is the
 * authority on collisions — two concurrent creates of the same slug both pass
 * this regex, so the 409 path (via `validationMessage`) exists regardless.
 */
export function OrgStep({
  busy = false,
  validationMessage = null,
  onCreate,
  onBack,
  onSkip,
}: OrgStepProps) {
  const { name, slug, handleNameChange, handleSlugChange } = useNameSlug();

  const trimmedName = name.trim();
  const slugValid = ORG_SLUG_PATTERN.test(slug);
  const slugShapeMessage =
    slug.length > 0 && !slugValid
      ? "Use 2–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit."
      : undefined;
  const canContinue = trimmedName.length > 0 && slugValid && !busy;

  const handleSubmit = () => {
    if (!canContinue) return;
    onCreate(trimmedName, slug);
  };

  return (
    <OnboardingStepShell
      currentStep={3}
      title="Create your organization"
      description="The slug becomes part of your organization's identity — short, lowercase, unique."
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="secondary" onClick={onSkip} disabled={busy}>
            Skip setup
          </Button>
          <Button onClick={handleSubmit} disabled={!canContinue}>
            Create organization
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <FormField label="Organization name" htmlFor="org-name">
          <Input
            id="org-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Acme Robotics"
            disabled={busy}
            autoFocus
          />
        </FormField>

        <FormField
          label="Slug"
          htmlFor="org-slug"
          hint="Suggested from the name until you edit it."
          validationMessage={slugShapeMessage ?? validationMessage ?? undefined}
        >
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="acme-robotics"
            disabled={busy}
          />
        </FormField>
      </div>
    </OnboardingStepShell>
  );
}
