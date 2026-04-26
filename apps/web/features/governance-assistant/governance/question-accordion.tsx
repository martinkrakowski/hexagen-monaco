import { ChevronDown, MessageSquare } from "lucide-react";
import type { PrebakedQuestion } from "@hexagen/prompt-compiler";

interface QuestionAccordionProps {
  question: PrebakedQuestion;
  isExpanded: boolean;
  onToggle: () => void;
  disabled: boolean;
  children: React.ReactNode;
}

export function QuestionAccordion({
  question,
  isExpanded,
  onToggle,
  disabled,
  children,
}: QuestionAccordionProps) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={[
          "group w-full text-left border p-3.5 transition-all hover:-translate-y-px",
          isExpanded
            ? "rounded-t-xl rounded-b-none border-primary/30 bg-primary/[0.08]"
            : "rounded-xl border-card-border bg-muted/20 hover:bg-primary/5 hover:border-primary/25",
          disabled && "opacity-50 cursor-not-allowed",
        ].join(" ")}
      >
        <div className="flex items-start gap-3">
          <div
            className={[
              "mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
              isExpanded
                ? "bg-primary/20"
                : "bg-muted-foreground/15 group-hover:bg-primary/15",
            ].join(" ")}
          >
            <MessageSquare
              size={11}
              className={isExpanded ? "text-primary" : "text-muted-foreground"}
              strokeWidth={2}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className={[
                "text-sm leading-snug transition-colors mt-1",
                isExpanded
                  ? "text-primary font-medium"
                  : "text-foreground/80 group-hover:text-foreground",
              ].join(" ")}
            >
              {question.label}
            </p>
          </div>
          <ChevronDown
            size={12}
            className={[
              "mt-0.5 flex-shrink-0 transition-transform",
              isExpanded
                ? "rotate-180 text-primary"
                : "text-muted-foreground/60 group-hover:text-muted-foreground",
            ].join(" ")}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="bg-muted/5 border-t border-border p-4">{children}</div>
      )}
    </div>
  );
}
