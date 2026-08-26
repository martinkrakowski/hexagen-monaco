import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

/**
 * Step-progress indicator for multi-step flows.
 *
 * Generalizes `apps/web/features/landing/components/CreationStepIndicator` and
 * exists to end the deliberate duplication of that markup in
 * `apps/web/features/brownfield/views/BrownfieldStepIndicator` (which could not
 * import across slices — check 6 of `scripts/validate-ui-boundary.sh`). Both
 * call sites can now consume this primitive instead.
 *
 * Renders an ordered list; the active step carries `aria-current="step"`.
 * Completed, current and upcoming steps are visually distinct (tokens only):
 * completed dots are solid primary with foreground labels, the current dot is
 * primary with a ring and a primary-colored label, upcoming dots are muted.
 */
export type StepperStep = {
  readonly label: string;
  readonly step: number;
};

export type StepperProps = NoSemanticState<{
  steps: readonly StepperStep[];
  currentStep: number;
  ariaLabel?: string;
  className?: string;
}>;

export function Stepper({
  steps,
  currentStep,
  ariaLabel = "Progress",
  className,
}: StepperProps) {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn("flex items-center justify-center", className)}
    >
      {steps.map((step, index) => {
        const isCurrent = step.step === currentStep;
        const isUpcoming = step.step > currentStep;

        return (
          <li
            key={step.step}
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-center"
          >
            {index > 0 ? (
              <div className="w-8 sm:w-16 h-px bg-border mx-1 sm:mx-3" />
            ) : null}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  isCurrent
                    ? "bg-primary ring-2 ring-ring ring-offset-2 ring-offset-background"
                    : isUpcoming
                      ? "bg-muted"
                      : "bg-primary",
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isCurrent
                    ? "text-primary"
                    : isUpcoming
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
