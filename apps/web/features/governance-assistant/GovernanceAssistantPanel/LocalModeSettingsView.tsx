"use client";

import { useState, useEffect } from "react";
import { ModelSettingsView } from "@hexagen/model-settings";
import { PanelFooter } from "../governance";
import type { ModeWrapperProps } from "./types";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import { hasServerLLMAccessKey } from "../../../app/lib/wire";
import { getCapabilities } from "@/lib/manifest-generation";

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
  | "onResetConfig"
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
  onResetConfig,
}: LocalModeSettingsViewProps) {
  const [serverModelName, setServerModelName] = useState<string>("gpt-4o-mini");

  useEffect(() => {
    getCapabilities()
      .then((res) => {
        if (res.activeModelName) {
          setServerModelName(res.activeModelName);
        }
      })
      .catch(() => {});
  }, []);

  if (
    panelView !== "model-settings" ||
    (llmEngineState.status !== "ready" &&
      !showRequiresModel &&
      !hasServerLLMAccessKey())
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
        requiresModelWarning={showRequiresModel && !hasServerLLMAccessKey()}
        onResetConfig={onResetConfig}
        hasServerApiKey={hasServerLLMAccessKey()}
        serverModelName={serverModelName}
      />
      <PanelFooter showHint={false} />
    </div>
  );
}
