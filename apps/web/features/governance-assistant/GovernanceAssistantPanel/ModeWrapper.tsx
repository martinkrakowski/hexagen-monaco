"use client";

import { CloudModeView } from "./CloudModeView";
import { LocalModeView } from "./LocalModeView";
import type { ModeWrapperProps } from "./types";

export function ModeWrapper({
  mode,
  panelView,
  onModeChange,
  cloudConnectionState,
  cloudConnectionError,
  onCloudConnect,
  onCloudDisconnect,
  onRetryConnection,
  cloudMessages,
  cloudLLMStatus,
  cloudLLMError,
  onSendMessage,
  onAbort,
  onClear,
  modelName,
  llmEngineState,
  showBootSpinner,
  showUnavailable,
  showWakingUp,
  showProgress,
  showError,
  showRequiresModel,
  onRefresh,
  isLoading,
  onCancelDownload,
  onOpenSettings,
  onBackFromSettings,
  onSwitchToCloud,
  loadedModel,
  messagesLength,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onInitModel,
  onResetConfig,
}: ModeWrapperProps) {
  if (mode === "cloud") {
    return (
      <CloudModeView
        cloudConnectionState={cloudConnectionState}
        cloudConnectionError={cloudConnectionError}
        onModeChange={onModeChange}
        onCloudConnect={onCloudConnect}
        onCloudDisconnect={onCloudDisconnect}
        onRetryConnection={onRetryConnection}
        cloudMessages={cloudMessages}
        cloudLLMStatus={cloudLLMStatus}
        cloudLLMError={cloudLLMError}
        onSendMessage={onSendMessage}
        onAbort={onAbort}
        onClear={onClear}
        modelName={modelName}
      />
    );
  }

  return (
    <LocalModeView
      llmEngineState={llmEngineState}
      showBootSpinner={showBootSpinner}
      showUnavailable={showUnavailable}
      showWakingUp={showWakingUp}
      showProgress={showProgress}
      showError={showError}
      showRequiresModel={showRequiresModel}
      onRefresh={onRefresh}
      isLoading={isLoading}
      onCancelDownload={onCancelDownload}
      onOpenSettings={onOpenSettings}
      onBackFromSettings={onBackFromSettings}
      onSwitchToCloud={onSwitchToCloud}
      loadedModel={loadedModel}
      messagesLength={messagesLength}
      onSwitchModel={onSwitchModel}
      onDeleteModel={onDeleteModel}
      hasModelInCache={hasModelInCache}
      onInitModel={onInitModel}
      panelView={panelView}
      onResetConfig={onResetConfig}
    />
  );
}
