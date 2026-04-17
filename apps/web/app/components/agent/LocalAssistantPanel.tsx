"use client";

import { useLocalLLM } from "@/hooks/use-local-llm";
import { OptInCard } from "./OptInCard";
import { ModelProgressCard } from "./ModelProgressCard";
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
      />
    );
  }

  if (showChat) {
    return (
      <LocalChatInterface
        messages={messages}
        isStreaming={isStreaming}
        onSendMessage={sendMessage}
      />
    );
  }

  return null;
}
