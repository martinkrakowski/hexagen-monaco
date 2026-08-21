import { Check } from "lucide-react";

const WIZARD_STEP_LABELS = [
  "Workspace",
  "Contexts",
  "Mappings",
  "Ports",
  "Export",
  "Summary",
];

interface StepPillsProps {
  currentStepIndex: number;
}

export function StepPills({ currentStepIndex }: StepPillsProps) {
  return (
    <div className="px-2 py-4 flex-shrink-0">
      <div className="flex items-center gap-1.5 mb-3">
        {WIZARD_STEP_LABELS.map((label, i) => {
          const isActive = i === currentStepIndex;
          const isCompleted = i < currentStepIndex;
          return (
            <div
              key={label}
              // The active pill's `ring-1 ring-primary/20` is the token-system
              // spelling of the former arbitrary
              // `shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]`: ring-offset-width
              // defaults to 0, so Tailwind emits the same 1px primary/20
              // box-shadow without the arbitrary value DESIGN.md §4.8 forbids.
              className={[
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-default select-none",
                isActive
                  ? "bg-primary/15 text-primary ring-1 ring-primary/20"
                  : isCompleted
                    ? "text-success"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
              ].join(" ")}
            >
              {isCompleted ? (
                <Check size={10} strokeWidth={3} />
              ) : (
                <span className="text-xs font-semibold">{i + 1}</span>
              )}
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
