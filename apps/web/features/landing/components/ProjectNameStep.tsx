"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, Input, Label } from "@hexagen/ui";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import { CREATION_STEPS } from "@/landing/domain/creation-path";

interface ProjectNameStepProps {
  /** Heading shown above the input (e.g. "Name your project"). */
  readonly title?: string;
  /** Supporting copy describing what the name is used for. */
  readonly description?: string;
  /** Pre-fills the input (e.g. carried back from a previous step). */
  readonly defaultValue?: string;
  /** Disables the form while the parent persists/navigates. */
  readonly busy?: boolean;
  /** Error surfaced by the parent (e.g. a persistence failure). */
  readonly error?: string | null;
  /** Called with the trimmed name when the user continues. */
  readonly onSubmit: (name: string) => void;
  /** Called when the user goes back to path selection. */
  readonly onBack: () => void;
}

/**
 * Shared "Project Name" step for every Create stream (blank / AI / import).
 * Presentational only — the parent owns what happens with the name (saving,
 * routing). The entered name becomes the saved-project name and seeds the
 * generated workspace name; see `createDefaultProjectConfig` and the stream pages.
 */
export function ProjectNameStep({
  title = "Name your project",
  description = "This becomes your saved project name and the name of the generated workspace.",
  defaultValue = "",
  busy = false,
  error = null,
  onSubmit,
  onBack,
}: ProjectNameStepProps) {
  const [name, setName] = useState(defaultValue);
  const trimmed = name.trim();
  const canContinue = trimmed.length > 0 && !busy;

  const handleSubmit = () => {
    if (!canContinue) return;
    onSubmit(trimmed);
  };

  return (
    <ProjectsShellWithFreeTier
      title="New Project"
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleSubmit} disabled={!canContinue}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </>
      }
    >
      <div className="h-full overflow-y-auto dot-grid bg-ambient">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />

            <div className="text-center mb-12 animate-fade-in-up delay-100">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-4">
                {title}
              </h1>
              <p className="text-muted-foreground text-lg leading-relaxed">
                {description}
              </p>
            </div>

            <div className="space-y-2 animate-fade-in-up delay-200">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="My Project"
                disabled={busy}
                autoFocus
                aria-invalid={error ? true : undefined}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive text-center"
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}
