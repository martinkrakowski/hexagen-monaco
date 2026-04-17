"use client";

import { useLocalLLM } from "@/hooks/use-local-llm";
import { OptInCard } from "./OptInCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { ModelFooterIndicator } from "./ModelFooterIndicator";
import { WakingUpCard } from "./WakingUpCard";
import { LocalChatInterface } from "./LocalChatInterface";
import { UnavailableCard } from "./UnavailableCard";

export function LocalAssistantPanel() {
  const {
    engineState,
    messages,
    isStreaming,
    initializeModel,
    cancelDownload,
    sendMessage,
    clearError,
    loadedModel,
    switchModel,
    deleteCachedModel,
  } = useLocalLLM();

  const { status, progress, errorMessage, autoLoading } = engineState;

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showOptIn = status === "opt_in" || status === "unavailable";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showChat = status === "ready";

  if (showUnavailable) {
    return <UnavailableCard status={status} />;
  }

  if (showOptIn) {
    return <OptInCard onInitialize={initializeModel} isInitializing={false} />;
  }

  if (showWakingUp) {
    return <WakingUpCard onCancel={cancelDownload} />;
  }

  if (showProgress) {
    return (
      <ModelProgressCard
        status={status}
        progress={progress}
        errorMessage={errorMessage}
        onCancel={cancelDownload}
        onRetry={clearError}
        model={loadedModel}
        modelId={
          status === "downloading"
            ? (engineState.loadedModelId ?? undefined)
            : undefined
        }
      />
    );
  }

  if (showError) {
    return (
      <ModelProgressCard
        status={status}
        progress={progress}
        errorMessage={errorMessage}
        onRetry={initializeModel}
        model={loadedModel}
        modelId={engineState.loadedModelId ?? undefined}
      />
    );
  }

  if (showChat) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end px-4 py-2 border-b border-border shrink-0">
          <ModelFooterIndicator
            modelId={engineState.loadedModelId}
            loadedModel={loadedModel}
            messagesLength={messages.length}
            onSelectModel={switchModel}
            onDeleteModel={deleteCachedModel}
            isLoading={false}
          />
        </div>
        <LocalChatInterface
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={sendMessage}
        />
      </div>
    );
  }

  return null;
}
