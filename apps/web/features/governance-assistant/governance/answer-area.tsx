import { Loader2, RotateCcw } from "lucide-react";
import { ThinkingIndicator } from "./thinking-indicator";

interface AnswerAreaProps {
  content: string;
  isRegenerating: boolean;
  onRegenerate: (id: string) => void;
  entryId: string;
  disabled: boolean;
}

export function AnswerArea({
  content,
  isRegenerating,
  onRegenerate,
  entryId,
  disabled,
}: AnswerAreaProps) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-primary" />
          <p className="text-sm font-medium text-foreground leading-snug">
            AI Answer
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRegenerate(entryId)}
          disabled={disabled || isRegenerating}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Regenerate this answer"
        >
          <RotateCcw size={12} strokeWidth={2} />
        </button>
      </div>

      {isRegenerating ? (
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-primary" />
          <p className="text-xs text-foreground/60">Regenerating...</p>
        </div>
      ) : content ? (
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      ) : (
        <ThinkingIndicator />
      )}
    </div>
  );
}
