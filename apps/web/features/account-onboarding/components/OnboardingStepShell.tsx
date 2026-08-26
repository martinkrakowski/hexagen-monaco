"use client";

import { Stepper } from "@hexagen/ui";
import { ProjectsShell } from "@/ProjectsShell";
import { ONBOARDING_STEPS } from "../domain/onboarding-steps";

interface OnboardingStepShellProps {
  /** 1-based step number — drives the Stepper's `aria-current`. */
  readonly currentStep: number;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  /** Back / Skip / Continue buttons, owned by the individual screens. */
  readonly footer?: React.ReactNode;
}

/**
 * Shared frame for the six onboarding screens: ProjectsShell with the
 * @hexagen/ui Stepper at the top of the content column. Presentational only —
 * screens own their form state and footers, containers own busy/errors and
 * navigation.
 */
export function OnboardingStepShell({
  currentStep,
  title,
  description,
  children,
  footer,
}: OnboardingStepShellProps) {
  return (
    <ProjectsShell title="Set up your account" footer={footer}>
      <div className="h-full overflow-y-auto dot-grid bg-ambient">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-xl mx-auto px-4 sm:px-6 w-full">
            <Stepper
              steps={ONBOARDING_STEPS}
              currentStep={currentStep}
              ariaLabel="Onboarding progress"
              className="mb-12"
            />

            <div className="text-center mb-8">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-4">
                {title}
              </h1>
              {description ? (
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {description}
                </p>
              ) : null}
            </div>

            {children}
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
