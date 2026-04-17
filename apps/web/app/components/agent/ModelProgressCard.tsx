"use client";

import type { LLMEngineStatus, ModelMetadata } from "@hexagen/local-llm";
import { getModelDescriptor } from "@/config/models";

interface ModelProgressCardProps {
  status: LLMEngineStatus;
  progress: number;
  errorMessage: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  model?: ModelMetadata | null;
  modelId?: string;
}

export function ModelProgressCard({
  status,
  progress,
  errorMessage,
  onCancel,
  onRetry,
  model,
  modelId,
}: ModelProgressCardProps) {
  const percent = Math.round(progress * 100);
  const isInProgress = status === "downloading" || status === "loading_vram";

  const displayModelId = model?.modelId ?? modelId;
  const descriptor = displayModelId ? getModelDescriptor(displayModelId) : null;

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
        {descriptor ? (
          <h3 className="text-sm font-semibold">
            {status === "downloading"
              ? `Downloading ${descriptor.displayName}`
              : status === "loading_vram"
                ? `Loading ${descriptor.displayName} into VRAM`
                : `Preparing ${descriptor.displayName}`}
          </h3>
        ) : (
          <h3 className="text-sm font-semibold">
            {status === "downloading"
              ? "Downloading Model"
              : status === "loading_vram"
                ? "Loading into VRAM"
                : "Preparing Model"}
          </h3>
        )}
        <p className="text-xs text-muted-foreground font-mono">
          {status === "downloading"
            ? `Downloading model weights… ${percent}%`
            : status === "loading_vram"
              ? `Compiling shaders and loading weights… ${percent}%`
              : "Please wait"}
        </p>
        {model && (
          <p className="text-[11px] text-muted-foreground/70">
            {model.parameterSize} · {model.quantizeLevel} ·{" "}
            {model.contextLength.toLocaleString()} ctx
          </p>
        )}
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
