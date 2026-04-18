"use client";

import { useState } from "react";
import { useLocalLLM } from "@/hooks/use-local-llm";
import { useCloudLLM, type UseCloudLLMConfig } from "@/hooks/use-cloud-llm";
import { getClientProviders } from "@/config/cloud-providers";
import { OptInCard } from "./OptInCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { ModelFooterIndicator } from "./ModelFooterIndicator";
import { ModelSettingsView } from "./ModelSettingsView";
import { WakingUpCard } from "./WakingUpCard";
import { LocalChatInterface } from "./LocalChatInterface";
import { UnavailableCard } from "./UnavailableCard";
import { CloudModelSettingsView } from "./CloudModelSettingsView";
import { CloudChatInterface } from "./CloudChatInterface";

type PanelView = "main" | "model-settings";
type LLMMode = "local" | "cloud";

export function LocalAssistantPanel() {
  const [mode, setMode] = useState<LLMMode>("local");
  const [cloudConfig, setCloudConfig] = useState<UseCloudLLMConfig | null>(
    null,
  );

  const localLLM = useLocalLLM();
  const cloudLLM = useCloudLLM();

  const {
    engineState,
    messages,
    isStreaming,
    initializeModel,
    cancelDownload,
    sendMessage,
    loadedModel,
    switchModel,
    deleteCachedModel,
    hasModelInCache,
  } = localLLM;

  const [panelView, setPanelView] = useState<PanelView>("main");

  const { status, progress, errorMessage, autoLoading } = engineState;

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showOptIn = status === "opt_in" || status === "unavailable";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showChat = status === "ready";

  if (panelView === "model-settings" && status !== "ready") {
    setPanelView("main");
  }

  const handleCloudConnect = (
    provider: string,
    model: string,
    apiKey: string,
  ) => {
    setCloudConfig({ provider, model, apiKey });
  };

  const handleCloudDisconnect = () => {
    setCloudConfig(null);
    cloudLLM.clearMessages();
  };

  // ─── Cloud Mode ────────────────────────────────────────────────

  if (mode === "cloud") {
    if (!cloudConfig) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex border-b border-border shrink-0">
            <button
              type="button"
              onClick={() => setMode("local")}
              className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Local
            </button>
            <button
              type="button"
              className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
            >
              Cloud
            </button>
          </div>
          <CloudModelSettingsView
            onConnect={handleCloudConnect}
            error={cloudLLM.errorMessage}
          />
        </div>
      );
    }

    const providerInfo = getClientProviders().find(
      (p) => p.id === cloudConfig.provider,
    );
    const modelName =
      providerInfo?.models.find((m) => m.id === cloudConfig.model)
        ?.displayName ?? cloudConfig.model;

    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setMode("local")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Local
          </button>
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Cloud
          </button>
        </div>
        <CloudChatInterface
          messages={cloudLLM.messages}
          isStreaming={cloudLLM.status === "streaming"}
          error={cloudLLM.errorMessage}
          onSendMessage={(content) =>
            cloudLLM.sendMessage(content, cloudConfig)
          }
          onAbort={cloudLLM.abort}
          onClear={cloudLLM.clearMessages}
          onDisconnect={handleCloudDisconnect}
          modelName={modelName}
        />
      </div>
    );
  }

  // ─── Local Mode ────────────────────────────────────────────────

  if (showUnavailable) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <UnavailableCard status={status} />
      </div>
    );
  }

  if (showOptIn) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <OptInCard
          onInitialize={() => initializeModel()}
          isInitializing={false}
        />
      </div>
    );
  }

  if (showWakingUp) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <WakingUpCard onCancel={cancelDownload} />
      </div>
    );
  }

  if (showProgress) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <ModelProgressCard
          status={status}
          progress={progress}
          errorMessage={errorMessage}
          onCancel={cancelDownload}
          onRetry={() => initializeModel()}
          model={loadedModel}
          modelId={
            status === "downloading"
              ? (engineState.loadedModelId ?? undefined)
              : undefined
          }
        />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <ModelProgressCard
          status={status}
          progress={progress}
          errorMessage={errorMessage}
          onRetry={() => initializeModel()}
          model={loadedModel}
          modelId={engineState.loadedModelId ?? undefined}
        />
      </div>
    );
  }

  if (panelView === "model-settings" && showChat) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => setMode("cloud")}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cloud
          </button>
        </div>
        <ModelSettingsView
          currentModelId={engineState.loadedModelId}
          loadedModel={loadedModel}
          messagesLength={messages.length}
          onSwitchModel={switchModel}
          onDeleteModel={deleteCachedModel}
          hasModelInCache={hasModelInCache}
          onBack={() => setPanelView("main")}
          isLoading={
            engineState.status === "downloading" ||
            engineState.status === "loading_vram"
          }
        />
      </div>
    );
  }

  if (showChat) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex border-b-0">
            <button
              type="button"
              className="px-3 py-1 text-sm font-medium border-b-2 border-primary text-foreground"
            >
              Local
            </button>
            <button
              type="button"
              onClick={() => setMode("cloud")}
              className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cloud
            </button>
          </div>
          <ModelFooterIndicator
            modelId={engineState.loadedModelId}
            onOpenSettings={() => setPanelView("model-settings")}
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
