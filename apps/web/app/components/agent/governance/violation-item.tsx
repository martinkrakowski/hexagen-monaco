import { ShieldCheck } from "lucide-react";
import type { Violation } from "@/lib/governance-question-templates";

interface ViolationItemProps {
  violation: Violation;
  isSelected: boolean;
  onSelect: () => void;
}

export function ViolationItem({
  violation,
  isSelected,
  onSelect,
}: ViolationItemProps) {
  const severityColor = {
    HIGH: "text-destructive",
    MEDIUM: "text-warning",
    LOW: "text-info",
  }[violation.severity];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full text-left rounded-lg border p-3 transition-all",
        isSelected
          ? "border-primary/30 bg-primary/[0.08]"
          : "border-border bg-muted/20 hover:bg-muted/40",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck
          size={14}
          className={`flex-shrink-0 mt-0.5 ${severityColor}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">
            {violation.message}
          </p>
          {violation.context && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {violation.context}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
