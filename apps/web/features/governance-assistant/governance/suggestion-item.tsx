import { Lightbulb } from "lucide-react";
import type { AISuggestion } from "@hexagen/prompt-compiler";

interface SuggestionItemProps {
  suggestion: AISuggestion;
  isSelected: boolean;
  onSelect: () => void;
}

export function SuggestionItem({
  suggestion,
  isSelected,
  onSelect,
}: SuggestionItemProps) {
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
        <Lightbulb size={14} className="flex-shrink-0 mt-0.5 text-accent" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">
            {suggestion.message}
          </p>
        </div>
      </div>
    </button>
  );
}
