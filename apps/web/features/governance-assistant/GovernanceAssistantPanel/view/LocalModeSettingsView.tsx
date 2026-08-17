"use client";

import { ModelSettingsView } from "@hexagen/model-settings";
import { PanelFooter } from "../../governance";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import type { ServerCapabilityNames } from "../types";

export interface LocalModeSettingsViewProps {
  /** Lifecycle is `requires-model`: warn that a model still has to be picked. */
  requiresModel: boolean;
  isLoading: boolean;
  capabilities: ServerCapabilityNames;
  serverAssistantAvailable: boolean;
  loadedModel: ModelMetadata | null;
  loadedModelId: DomainModelId | null;
  messagesLength: number;
  onSwitchModel: (modelId: DomainModelId) => Promise<void>;
  onDeleteModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  onBackFromSettings: () => void;
  onSwitchToCloud: () => void;
  onResetConfig?: () => void;
}

/**
 * Model-settings card for local mode.
 *
 * It used to run its own `getCapabilities()` effect (REA-006) and call
 * `hasServerLLMAccessKey()` from the DI container twice, then decide with a
 * three-clause boolean whether to render at all. The probe now happens once in
 * the boundary and arrives here as `capabilities`; the render decision belongs
 * to `LocalModeView`'s discriminant.
 *
 * `chatModelName` stays `undefined` until the probe resolves so
 * `ModelSettingsView`'s own `?? "Configured by environment"` fallback works.
 * The old local default was `""`, which is not nullish — the card rendered a
 * blank row instead.
 */
export function LocalModeSettingsView({
  requiresModel,
  isLoading,
  capabilities,
  serverAssistantAvailable,
  loadedModel,
  loadedModelId,
  messagesLength,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onBackFromSettings,
  onSwitchToCloud,
  onResetConfig,
}: LocalModeSettingsViewProps) {
  return (
    <div className="flex flex-col h-full">
      <ModelSettingsView
        key={loadedModelId ?? "none"}
        currentModelId={loadedModelId}
        loadedModel={loadedModel}
        messagesLength={messagesLength}
        onSwitchModel={onSwitchModel}
        onDeleteModel={onDeleteModel}
        hasModelInCache={hasModelInCache}
        onBack={onBackFromSettings}
        isLoading={isLoading}
        onSwitchToCloud={onSwitchToCloud}
        requiresModelWarning={requiresModel}
        onResetConfig={onResetConfig}
        hasServerApiKey={serverAssistantAvailable}
        serverModelName={capabilities.chatModelName}
        generationModelName={capabilities.generationModelName}
      />
      <PanelFooter showHint={false} />
    </div>
  );
}
