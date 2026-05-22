"use client";

import type { DomainModelId } from "@hexagen/local-llm";
import { getModelShortName } from "@hexagen/local-llm";

interface ModelFooterIndicatorProps {
  modelId?: DomainModelId | null;
  modelLabel?: string;
  onOpenSettings: () => void;
  isLoading: boolean;
}

export function ModelFooterIndicator({
  modelId,
  modelLabel,
  onOpenSettings,
  isLoading,
}: ModelFooterIndicatorProps) {
  if (!modelId && !modelLabel) return null;

  const displayName = modelLabel || (modelId ? getModelShortName(modelId) : "");

  return (
    <button
      onClick={onOpenSettings}
      disabled={isLoading}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted/80 text-xs font-medium text-foreground/80 transition-colors disabled:opacity-50"
      title={`${displayName} — click to manage model`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-soft-pulse shrink-0" />
      {displayName}
    </button>
  );
}
