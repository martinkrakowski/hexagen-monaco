"use client";

import { ModelSettingsView } from "@hexagen/model-settings";
import { PanelFooter } from "../governance";
import type { ModeWrapperProps } from "./types";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";

type LocalModeSettingsViewProps = Pick<
  ModeWrapperProps,
  | "panelView"
  | "showRequiresModel"
  | "llmEngineState"
  | "loadedModel"
  | "messagesLength"
  | "onSwitchModel"
  | "onDeleteModel"
  | "hasModelInCache"
  | "onBackFromSettings"
  | "onSwitchToCloud"
>;

export function LocalModeSettingsView({
  panelView,
  showRequiresModel,
  llmEngineState,
  loadedModel,
  messagesLength,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onBackFromSettings,
  onSwitchToCloud,
}: LocalModeSettingsViewProps) {
  if (
    panelView !== "model-settings" ||
    (llmEngineState.status !== "ready" && !showRequiresModel)
  ) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <ModelSettingsView
        key={llmEngineState.loadedModelId ?? "none"}
        currentModelId={llmEngineState.loadedModelId as DomainModelId | null}
        loadedModel={loadedModel as ModelMetadata | null}
        messagesLength={messagesLength}
        onSwitchModel={
          onSwitchModel as (modelId: DomainModelId) => Promise<void>
        }
        onDeleteModel={
          onDeleteModel as (modelId: DomainModelId) => Promise<void>
        }
        hasModelInCache={
          hasModelInCache as (modelId: DomainModelId) => Promise<boolean>
        }
        onBack={onBackFromSettings}
        isLoading={
          llmEngineState.status === "downloading" ||
          llmEngineState.status === "loading_vram"
        }
        onSwitchToCloud={onSwitchToCloud}
        requiresModelWarning={showRequiresModel}
      />
      <PanelFooter showHint={false} />
    </div>
  );
}
