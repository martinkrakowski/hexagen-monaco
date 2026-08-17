"use client";

import { CloudModeView, type CloudModeViewProps } from "./CloudModeView";
import { LocalModeView, type LocalModeViewProps } from "./LocalModeView";
import type { LLMMode } from "../types";

export interface ModeWrapperProps
  extends CloudModeViewProps, LocalModeViewProps {
  mode: LLMMode;
}

/**
 * Picks the local or cloud half of the panel.
 *
 * It carries both halves' props because the boundary computes both; it decodes
 * nothing beyond `mode`. Everything the local half needs to know about engine
 * state now arrives as a single `lifecycle` discriminant rather than as six
 * booleans this component had to forward one by one.
 */
export function ModeWrapper({ mode, ...props }: ModeWrapperProps) {
  if (mode === "cloud") {
    return (
      <CloudModeView
        vault={props.vault}
        cloudConnectionState={props.cloudConnectionState}
        cloudConnectionError={props.cloudConnectionError}
        onModeChange={props.onModeChange}
        onCloudConnect={props.onCloudConnect}
        onCloudDisconnect={props.onCloudDisconnect}
        onRetryConnection={props.onRetryConnection}
        cloudMessages={props.cloudMessages}
        cloudLLMStatus={props.cloudLLMStatus}
        cloudLLMError={props.cloudLLMError}
        onSendMessage={props.onSendMessage}
        onAbort={props.onAbort}
        onClear={props.onClear}
        modelName={props.modelName}
      />
    );
  }

  return (
    <LocalModeView
      lifecycle={props.lifecycle}
      isLoading={props.isLoading}
      capabilities={props.capabilities}
      serverAssistantAvailable={props.serverAssistantAvailable}
      loadedModel={props.loadedModel}
      loadedModelId={props.loadedModelId}
      messagesLength={props.messagesLength}
      onCancelDownload={props.onCancelDownload}
      onOpenSettings={props.onOpenSettings}
      onInitModel={props.onInitModel}
      onBackFromSettings={props.onBackFromSettings}
      onSwitchToCloud={props.onSwitchToCloud}
      onSwitchModel={props.onSwitchModel}
      onDeleteModel={props.onDeleteModel}
      hasModelInCache={props.hasModelInCache}
      onResetConfig={props.onResetConfig}
    />
  );
}
