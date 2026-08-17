"use client";

import type { DomainModelId } from "@hexagen/local-llm/client";
import { getModelShortName } from "@hexagen/local-llm/client";

interface ModelFooterIndicatorProps {
  modelId: DomainModelId | null;
  onOpenSettings: () => void;
  isLoading: boolean;
}

export function ModelFooterIndicator({
  modelId,
  onOpenSettings,
  isLoading,
}: ModelFooterIndicatorProps) {
  if (!modelId) return null;

  const shortName = getModelShortName(modelId);

  return (
    <button
      onClick={onOpenSettings}
      disabled={isLoading}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted/80 text-xs font-medium text-foreground/80 transition-colors disabled:opacity-50"
      title={`${shortName} — click to manage model`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-soft-pulse shrink-0" />
      {shortName}
    </button>
  );
}
