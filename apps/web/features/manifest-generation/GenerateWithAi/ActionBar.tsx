import { Button } from "@hexagen/ui";
import type { ActionBarProps } from "./types";

export function ActionBar({
  canGenerate,
  isGenerating,
  onGenerate,
  onCancel,
  disabledTooltip,
}: ActionBarProps) {
  return (
    <div className="space-y-4">
      {isGenerating ? (
        <div className="flex gap-2">
          <Button
            onClick={onCancel}
            variant="secondary"
            className="flex-1 h-11 rounded-md font-medium"
            size="lg"
          >
            Cancel
          </Button>
          <Button
            disabled
            className="flex-1 bg-primary text-primary-foreground font-medium h-11 rounded-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            size="lg"
          >
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
          </Button>
        </div>
      ) : (
        <Button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="w-full bg-primary text-primary-foreground font-medium h-11 rounded-md flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          size="lg"
          title={disabledTooltip}
        >
          Generate Manifest
        </Button>
      )}

      <p
        className="text-xs text-muted-foreground text-center"
        aria-live="polite"
      >
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
