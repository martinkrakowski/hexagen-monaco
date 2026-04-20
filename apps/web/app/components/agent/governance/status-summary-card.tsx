import type {
  Violation,
  AISuggestion,
} from "@/lib/governance-question-templates";

interface StatusSummaryCardProps {
  violations: Violation[];
  suggestions: AISuggestion[];
}

export function StatusSummaryCard({
  violations,
  suggestions,
}: StatusSummaryCardProps) {
  const violationCount = violations.length;
  const suggestionCount = suggestions.length;
  const hasIssues = violationCount > 0 || suggestionCount > 0;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="flex items-center gap-2.5">
        <div
          className={[
            "w-2 h-2 rounded-full",
            hasIssues
              ? "bg-destructive animate-soft-pulse"
              : "bg-success animate-soft-pulse",
          ].join(" ")}
        />
        <div>
          <p className="text-xs font-medium text-foreground">
            {hasIssues ? "Review Required" : "No Issues Found"}
          </p>
          {hasIssues && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {violationCount > 0 && <span>{violationCount} violation(s)</span>}
              {violationCount > 0 && suggestionCount > 0 && <span>, </span>}
              {suggestionCount > 0 && (
                <span>{suggestionCount} suggestion(s)</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
