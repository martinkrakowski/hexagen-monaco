import { Button } from "@hexagen/ui";
import type { ActionBarProps } from "./types";

const PHASE_LABELS: Record<string, string> = {
  topology: "Analyzing project topology...",
  clarification_needed: "Reviewing topology...",
  adapters: "Generating adapters...",
  rendering: "Rendering manifest...",
  complete: "Complete",
  failed: "Failed",
  idle: "",
};

export function ActionBar({
  canGenerate,
  isGenerating,
  phase,
  onGenerate,
}: ActionBarProps) {
  const phaseLabel = PHASE_LABELS[phase] ?? "Generating manifest...";

  return (
    <div className="space-y-4">
      <div className="mt-6">
        <Button
          onClick={onGenerate}
          disabled={!canGenerate}
          className={`w-full h-10 bg-primary text-primary-foreground font-bold rounded-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] active:opacity-90 ${isGenerating ? "animate-pulse" : ""}`}
          size="lg"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin mr-2" aria-hidden="true">
                ⏳
              </span>
              {phaseLabel}
            </>
          ) : (
            "Generate Manifest"
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4 animate-fade-in-up delay-300">
        AI will analyze your description to identify relevant domain structures,
        ports, and adapters.
      </p>
    </div>
  );
}
