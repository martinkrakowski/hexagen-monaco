"use client";

import type { LLMEngineStatus } from "@hexagen/local-llm";

interface ModelProgressCardProps {
  status: LLMEngineStatus;
  progress: number;
  errorMessage: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function ModelProgressCard({
  status,
  progress,
  errorMessage,
  onCancel,
  onRetry,
}: ModelProgressCardProps) {
  const percent = Math.round(progress * 100);
  const isInProgress = status === "downloading" || status === "loading_vram";

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
        <svg
          className="h-6 w-6 text-primary animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
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
      </div>
      <div className="text-center space-y-1">
        <h3 className="text-sm font-semibold">
          {status === "downloading"
            ? "Downloading Model"
            : status === "loading_vram"
              ? "Loading into VRAM"
              : "Preparing Model"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {status === "downloading"
            ? `Downloading model weights… ${percent}%`
            : status === "loading_vram"
              ? `Compiling shaders and loading weights… ${percent}%`
              : "Please wait"}
        </p>
      </div>
      <div className="w-full max-w-[200px] h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-in-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {isInProgress && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground underline hover:no-underline transition-colors"
        >
          Cancel download
        </button>
      )}
      {status === "error" && errorMessage && (
        <p className="text-xs text-destructive text-center max-w-[260px]">
          {errorMessage}
          {onRetry && (
            <button
              onClick={onRetry}
              className="ml-2 underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
