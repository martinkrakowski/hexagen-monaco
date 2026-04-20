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
              className={[
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-default select-none",
                isActive
                  ? "bg-primary/15 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                  : isCompleted
                    ? "text-success"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
              ].join(" ")}
            >
              {isCompleted ? (
                <Check size={10} strokeWidth={3} />
              ) : (
                <span className="text-[10px] font-semibold">{i + 1}</span>
              )}
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
