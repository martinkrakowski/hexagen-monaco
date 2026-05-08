import { Button } from "@hexagen/ui";
import type { ActionBarProps } from "./types";

export function ActionBar({
  canGenerate,
  isGenerating,
  onCancel,
  onGenerate,
  disabledTooltip,
}: ActionBarProps) {
  if (isGenerating) {
    return (
      <div className="space-y-4">
        <div className="mt-6">
          <Button
            onClick={onCancel}
            variant="ghost"
            className="w-full h-10 font-medium rounded-md"
            size="lg"
          >
            Cancel
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-4">
          AI is analyzing your description to identify domain structures, ports,
          and adapters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mt-6">
        <Button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="w-full h-10 bg-primary text-primary-foreground font-bold rounded-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:opacity-90"
          size="lg"
          title={disabledTooltip}
        >
          Generate Manifest
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4 animate-fade-in-up delay-300">
        {disabledTooltip ? (
          <span className="text-amber-600">{disabledTooltip}</span>
        ) : (
          <>
            AI will analyze your description to identify relevant domain
            structures, ports, and adapters.
          </>
        )}
      </p>
    </div>
  );
}
