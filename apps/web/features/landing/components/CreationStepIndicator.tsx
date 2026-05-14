"use client";

import type { StepLabel } from "../domain/creation-path";

interface CreationStepIndicatorProps {
  readonly currentStep: number;
  readonly steps: readonly StepLabel[];
}

export function CreationStepIndicator({
  currentStep,
  steps,
}: CreationStepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-12 animate-fade-in-up">
      {steps.map((step, index) => {
        const isActive = step.step === currentStep;
        const isInactive = step.step > currentStep;

        return (
          <div key={step.step} className="flex items-center">
            {index > 0 && (
              <div className="w-8 sm:w-16 h-px bg-border mx-1 sm:mx-3" />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isActive
                    ? "bg-primary step-dot-active"
                    : isInactive
                      ? "bg-muted"
                      : "bg-primary"
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
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
