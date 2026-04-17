"use client";

import { useState } from "react";
import { getModelShortName } from "@/config/models";
import { ModelSelectionModal } from "./ModelSelectionModal";
import type { ModelMetadata } from "@hexagen/local-llm";

interface ModelFooterIndicatorProps {
  modelId: string | null;
  loadedModel: ModelMetadata | null;
  messagesLength: number;
  onSelectModel: (modelId: string) => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
  isLoading: boolean;
}

export function ModelFooterIndicator({
  modelId,
  loadedModel,
  messagesLength,
  onSelectModel,
  onDeleteModel,
  isLoading,
}: ModelFooterIndicatorProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!modelId) return null;

  const shortName = getModelShortName(modelId);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        disabled={isLoading}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted/80 text-[11px] font-medium text-foreground/80 transition-colors disabled:opacity-50"
        title={`${shortName} — click to change model`}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success shrink-0" />
        {shortName}
      </button>

      <ModelSelectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        currentModelId={modelId}
        onSelectModel={onSelectModel}
        onDeleteModel={onDeleteModel}
        loadedModel={loadedModel}
        isLoading={isLoading}
        messagesLength={messagesLength}
      />
    </>
  );
}
