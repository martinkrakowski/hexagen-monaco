"use client";

import { CloudModeView } from "./CloudModeView";
import { LocalModeView } from "./LocalModeView";
import { TandemChatView } from "../TandemChat/TandemChatView";
import { TandemLostConfigBanner } from "../TandemChat/TandemLostConfigBanner";
import type { ModeWrapperProps } from "./types";
import type { TandemChatMessage, TandemStatus } from "../hooks/useTandemLlm";
import { useTandemLostConfig } from "../hooks/useTandemLostConfig";

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
  onConfigSaved,
  onTandemDisabled,
  tandemDerivedStatus,
  tandemMessages,
  tandemStatus,
  onSendTandemMessage,
  onAbortTandem,
  onStageAwareAbortTandem,
  onClearTandem,
  tandemCurrentStage,
  tandemCanRetry,
  onRetryCloudRefinement,
  tandemLastBypassReason,
  tandemLastResponseWasPartial,
  tandemLastErrorType,
  tandemHasOomEvent,
  onClearBypassReason,
}: ModeWrapperProps) {
  const { showRecoveryBanner, dismissRecoveryBanner } = useTandemLostConfig();

  if (mode === "tandem") {
    const safeTandemMessages: TandemChatMessage[] = tandemMessages ?? [];
    const safeTandemStatus: TandemStatus = tandemStatus ?? "idle";
    const safeCurrentStage: "idle" | "stage1" | "transitioning" | "stage3" =
      tandemCurrentStage ?? "idle";
    const safeCanRetry: boolean = tandemCanRetry ?? false;

    const safeStageAwareAbort = onStageAwareAbortTandem ?? (() => undefined);
    const safeRetry: () => Promise<void> =
      onRetryCloudRefinement ?? (() => Promise.resolve());

    return (
      <div className="flex flex-col h-full">
        {showRecoveryBanner && (
          <TandemLostConfigBanner
            onDismiss={dismissRecoveryBanner}
            onOpenSettings={onOpenSettings}
          />
        )}
        <TandemChatView
          messages={safeTandemMessages}
          status={safeTandemStatus}
          currentStage={safeCurrentStage}
          sendMessage={onSendTandemMessage ?? (() => Promise.resolve())}
          abort={onAbortTandem ?? (() => undefined)}
          stageAwareAbort={safeStageAwareAbort}
          clear={onClearTandem ?? (() => undefined)}
          canRetry={safeCanRetry}
          retryCloudRefinement={safeRetry}
          lastBypassReason={tandemLastBypassReason ?? null}
          lastResponseWasPartial={tandemLastResponseWasPartial ?? false}
          lastErrorType={tandemLastErrorType ?? null}
          hasOomEvent={tandemHasOomEvent ?? false}
          clearBypassReason={onClearBypassReason ?? (() => undefined)}
          onModeChange={onModeChange}
          onOpenSettings={onOpenSettings}
        />
      </div>
    );
  }

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
      onConfigSaved={onConfigSaved}
      onTandemDisabled={onTandemDisabled}
      tandemDerivedStatus={tandemDerivedStatus}
    />
  );
}
