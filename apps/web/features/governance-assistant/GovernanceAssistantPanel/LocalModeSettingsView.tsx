"use client";

import { ModelSettingsView } from "@hexagen/model-settings";
import { PanelFooter } from "../governance";
import type { ModeWrapperProps } from "./types";

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
        currentModelId={llmEngineState.loadedModelId as any}
        loadedModel={loadedModel as any}
        messagesLength={messagesLength}
        onSwitchModel={onSwitchModel as any}
        onDeleteModel={onDeleteModel as any}
        hasModelInCache={hasModelInCache as any}
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
