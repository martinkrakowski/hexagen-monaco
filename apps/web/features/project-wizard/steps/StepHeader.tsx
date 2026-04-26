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
    <div className="flex-shrink-0 p-2">
       {debugLabel && (
         <div className="text-xs font-mono bg-muted text-muted-foreground p-2 rounded border border-border mb-4">
           {debugLabel}
         </div>
       )}
       <div className="relative flex w-full justify-between mb-4">
         <div className="absolute top-1/2 left-3.5 right-3.5 h-0.5 -translate-y-1/2 bg-muted z-0" />
        {currentStep > 1 && (
           <div
             className="absolute top-1/2 left-3.5 h-0.5 -translate-y-1/2 bg-primary z-0"
             style={{
               width: `calc(${((currentStep - 1) / (totalSteps - 1)) * 100}% - 28px)`,
             }}
           />
        )}
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => {
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;

          return (
            <div
              key={step}
              aria-current={isCurrent ? "step" : undefined}
              className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-medium ${
                isCurrent
                  ? "bg-primary text-primary-foreground border-primary"
                  : isCompleted
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-muted"
              }`}
            >
              {step}
            </div>
          );
        })}
      </div>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
