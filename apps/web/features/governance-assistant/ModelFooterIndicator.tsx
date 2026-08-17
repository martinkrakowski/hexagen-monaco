"use client";

import type { DomainModelId } from "@hexagen/local-llm";
import { getModelShortName } from "@hexagen/local-llm";

interface ModelFooterIndicatorProps {
  modelId?: DomainModelId | null;
  modelLabel?: string;
  /**
   * What to show when no model name is known — rendered without the live-model
   * dot, because there is no model to report as live.
   *
   * Opt-in, so the default contract ("no name, no chip") is unchanged for
   * callers that use this purely as an indicator. The governance panel footer
   * passes it because the chip is also that view's only route into model
   * settings: the server capability probe can still be in flight, or can have
   * failed, and losing the label must not lose the way out of the Q&A view.
   */
  fallbackLabel?: string;
  onOpenSettings: () => void;
  isLoading: boolean;
}

export function ModelFooterIndicator({
  modelId,
  modelLabel,
  fallbackLabel,
  onOpenSettings,
  isLoading,
}: ModelFooterIndicatorProps) {
  const modelName = modelLabel || (modelId ? getModelShortName(modelId) : "");
  const displayName = modelName || fallbackLabel;
  if (!displayName) return null;

  return (
    <button
      onClick={onOpenSettings}
      disabled={isLoading}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted/80 text-xs font-medium text-foreground/80 transition-colors disabled:opacity-50"
      title={modelName ? `${modelName} — click to manage model` : displayName}
    >
      {modelName && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-soft-pulse shrink-0" />
      )}
      {displayName}
    </button>
  );
}
