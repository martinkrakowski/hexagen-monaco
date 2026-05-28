"use client";

import type { TandemStatus } from "../hooks/useTandemLlm";

export interface TandemStopControlProps {
  currentStage: "idle" | "stage1" | "transitioning" | "stage3";
  status: TandemStatus;
  onAbortStage1: () => void;
  onAbortStage3: () => void;
  onAbortFull: () => void;
}

/**
 * TandemStopControl
 *
 * Renders a stage-aware stop button during tandem pipeline execution.
 * Each stage gets a distinct visual treatment and aria-label.
 *
 * - stage1      → amber pill "Stop Draft" (square icon)
 * - transitioning → muted pill "Cancel"
 * - stage3      → blue pill "Stop Cloud" (×)
 * - idle / error → renders nothing
 */
export function TandemStopControl({
  currentStage,
  status,
  onAbortStage1,
  onAbortStage3,
  onAbortFull,
}: TandemStopControlProps) {
  if (status === "idle" || status === "error") {
    return null;
  }

  if (currentStage === "stage1") {
    return (
      <button
        type="button"
        onClick={onAbortStage1}
        aria-label="Stop the local draft. The cloud model will not be called."
        title="Stop the local draft. The cloud model will not be called."
        className={[
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium",
          "border-l-2 border-amber-500",
          "bg-amber-50 text-amber-800 hover:bg-amber-100",
          "dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50",
          "transition-colors",
        ].join(" ")}
      >
        {/* Square stop icon */}
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-600 dark:bg-amber-400"
        />
        Stop Draft
      </button>
    );
  }

  if (currentStage === "transitioning") {
    return (
      <button
        type="button"
        onClick={onAbortFull}
        aria-label="Cancel the tandem request."
        title="Cancel the tandem request."
        className={[
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium",
          "border-l-2 border-border",
          "bg-muted text-muted-foreground hover:bg-muted/80",
          "transition-colors",
        ].join(" ")}
      >
        {/* × icon */}
        <span aria-hidden="true" className="text-sm leading-none">
          ✕
        </span>
        Cancel
      </button>
    );
  }

  if (currentStage === "stage3") {
    return (
      <button
        type="button"
        onClick={onAbortStage3}
        aria-label="Stop the cloud refinement. The local draft will be shown if available."
        title="Stop the cloud refinement. The local draft will be shown if available."
        className={[
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium",
          "border-l-2 border-blue-500",
          "bg-blue-50 text-blue-800 hover:bg-blue-100",
          "dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50",
          "transition-colors",
        ].join(" ")}
      >
        {/* × icon */}
        <span aria-hidden="true" className="text-sm leading-none">
          ✕
        </span>
        Stop Cloud
      </button>
    );
  }

  return null;
}
