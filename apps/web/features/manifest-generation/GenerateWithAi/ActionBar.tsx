import { Button } from "@hexagen/ui";
import type { ActionBarProps } from "./types";

export function ActionBar({
  canGenerate,
  isGenerating,
  onGenerate,
  disabledTooltip,
}: ActionBarProps) {
  return (
    <div className="space-y-4">
      <Button
        onClick={onGenerate}
        disabled={!canGenerate || isGenerating}
        className="w-full bg-primary text-primary-foreground font-medium h-11 rounded-md flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        size="lg"
        title={disabledTooltip}
      >
        {isGenerating ? (
          <>
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Generating...
          </>
        ) : (
          "Generate Manifest"
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {isGenerating ? (
          "AI is analyzing your description to identify domain structures, ports, and adapters."
        ) : disabledTooltip ? (
          <span className="text-amber-600">{disabledTooltip}</span>
        ) : (
          "AI will analyze your description to identify relevant domain structures, ports, and adapters."
        )}
      </p>
    </div>
  );
}
