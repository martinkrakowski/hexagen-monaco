"use client";

/**
 * The three-dot creation-flow indicator, shared by every brownfield screen.
 *
 * MOVED HERE, NOT NEWLY DUPLICATED. It lived as a file-private component inside
 * `BrownfieldImportPage`, which was correct while that page was the only screen
 * in the slice. Now that S3–S6 render their own `ProjectsShellWithFreeTier`
 * (each screen owns its own footer actions and its own content width, per the
 * plan's chrome rule), keeping it private would have meant a second, third and
 * fourth copy. One slice-local module is the smaller change.
 *
 * STILL DUPLICATED FROM `features/landing/components/CreationStepIndicator`, and
 * still on purpose: check 6 of `scripts/validate-ui-boundary.sh` makes
 * `features/brownfield` importing anything from `features/landing` a build
 * failure — the alias form (`@/landing/...`) included, with an empty,
 * shrink-only baseline. Promoting the shared component to `components/` is a
 * packet that touches the landing slice's consumers and is outside this fence.
 * Flagged for that promotion.
 */
const STEPS = [
  { label: "Method", step: 1 },
  { label: "Configure", step: 2 },
  { label: "Generate", step: 3 },
] as const;

export function BrownfieldStepIndicator() {
  const currentStep = 2;

  return (
    <div className="flex items-center justify-center gap-0 mb-12 animate-fade-in-up">
      {STEPS.map((step, index) => {
        const isActive = step.step === currentStep;
        const isInactive = step.step > currentStep;
        return (
          <div key={step.step} className="flex items-center">
            {index > 0 ? (
              <div className="w-8 sm:w-16 h-px bg-border mx-1 sm:mx-3" />
            ) : null}
            <div className="flex items-center gap-2">
              <div
                className={
                  isActive
                    ? "w-2 h-2 rounded-full bg-primary step-dot-active"
                    : isInactive
                      ? "w-2 h-2 rounded-full bg-muted"
                      : "w-2 h-2 rounded-full bg-primary"
                }
              />
              <span
                className={
                  isActive
                    ? "text-xs font-medium text-primary"
                    : "text-xs font-medium text-muted-foreground"
                }
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
