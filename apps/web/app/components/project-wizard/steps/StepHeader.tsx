"use client";

interface StepHeaderProps {
  currentStep: number;
  totalSteps: number;
  title: string;
  description: string;
  debugLabel?: string;
}

export function StepHeader({
  currentStep,
  totalSteps,
  title,
  description,
  debugLabel,
}: StepHeaderProps) {
  return (
    <div className="flex-shrink-0 p-5 pb-4">
      {debugLabel && (
        <div className="text-[10px] font-mono bg-muted text-muted-foreground p-2 rounded border border-border mb-4">
          {debugLabel}
        </div>
      )}
      <div className="flex gap-2 mb-4">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <div
            key={step}
            aria-current={currentStep === step ? "step" : undefined}
            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-medium ${
              currentStep === step
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-muted"
            }`}
          >
            {step}
          </div>
        ))}
      </div>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
