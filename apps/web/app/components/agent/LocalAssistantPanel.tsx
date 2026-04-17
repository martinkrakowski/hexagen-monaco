"use client";

import { useLocalLLM } from "@/hooks/use-local-llm";
import { OptInCard } from "./OptInCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { LocalChatInterface } from "./LocalChatInterface";
import { UnavailableCard } from "./UnavailableCard";

export function LocalAssistantPanel() {
  const {
    engineState,
    messages,
    isStreaming,
    initializeModel,
    sendMessage,
    clearError,
  } = useLocalLLM();

  const { status, progress, errorMessage } = engineState;

  const showOptIn = status === "opt_in" || status === "unavailable";
  const showProgress = status === "downloading" || status === "loading_vram";
  const showError = status === "error";
  const showChat = status === "ready";
  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";

  if (showUnavailable) {
    return <UnavailableCard status={status} />;
  }

  if (showOptIn) {
    return <OptInCard onInitialize={initializeModel} isInitializing={false} />;
  }

  if (showProgress) {
    return (
      <ModelProgressCard
        status={status}
        progress={progress}
        errorMessage={errorMessage}
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
