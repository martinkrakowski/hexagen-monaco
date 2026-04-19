"use client";

import { useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useLocalLLM } from "@/hooks/use-local-llm";
import { useCloudLLM, type UseCloudLLMConfig } from "@/hooks/use-cloud-llm";
import { useSecretVault } from "@/hooks/use-secret-vault";
import { getClientProviders } from "@/config/cloud-providers";
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
type PanelViewState = "initializing" | "settings" | "chat";

export function LocalAssistantPanel() {
  const [mode, setMode] = useState<LLMMode>("local");
  const [cloudConfig, setCloudConfig] = useState<UseCloudLLMConfig | null>(
    null,
  );

  const localLLM = useLocalLLM();
  const cloudLLM = useCloudLLM();
  const vault = useSecretVault();

  // Wire vault to cloudLLM hook when it becomes available
  useEffect(() => {
    if (vault) {
      cloudLLM.setVault(vault);
    }
  }, [vault, cloudLLM]);

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
    hasAnyCachedModel,
  } = localLLM;

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [viewState, setViewState] = useState<PanelViewState>("initializing");

  const { status, progress, errorMessage, autoLoading } = engineState;

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showChat = status === "ready";
  const showRequiresModel = status === "requires_model";

  // Hydration Effect: Determine viewState based on async cache check
  useEffect(() => {
    let isMounted = true;

    const determineViewState = async () => {
      if (mode === "local") {
        setViewState("initializing");
      }

      // Boot Guard: Abort if WebLLM adapter hasn't mounted yet
      if (engineState.status === "unavailable") {
        return;
      }

      // Check both keys: HAS_ENABLED_KEY (new) and AUTO_LOAD_KEY (legacy).
      // Users from before HAS_ENABLED_KEY was introduced only have AUTO_LOAD_KEY.
      const isOptedIn =
        localStorage.getItem("hexagen:local-llm:has-enabled") !== null ||
        localStorage.getItem("hexagen:local-llm:auto-load") === "true";

      // Opted-In Hold: If user is opted in but the engine is still in its
      // transit state (opt_in before auto-load) or actively loading,
      // hold the spinner until the engine transitions.
      if (
        isOptedIn &&
        (engineState.status === "opt_in" || engineState.autoLoading)
      ) {
        return;
      }

      try {
        const cachedModelsExist = await hasAnyCachedModel();

        if (!isMounted) return;

        // If not opted in, route to settings to select a model.
        if (!isOptedIn) {
          setViewState("settings");
          return;
        }

        // Only show settings if opted-in AND there's a model problem.
        // This covers: requires_model, or no loaded model but cached models exist.
        if (
          engineState.status === "requires_model" ||
          (!engineState.loadedModelId && cachedModelsExist)
        ) {
          setViewState("settings");
        } else if (
          engineState.loadedModelId ||
          engineState.status === "downloading" ||
          engineState.status === "loading_vram"
        ) {
          setViewState("chat");
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error determining local assistant view:", error);
        if (isMounted) setViewState("settings");
      }
    };

    determineViewState();

    return () => {
      isMounted = false;
    };
  }, [
    hasAnyCachedModel,
    engineState.status,
    engineState.loadedModelId,
    engineState.autoLoading,
    mode,
  ]);

  // When entering requires_model state, switch to model-settings view
  if (showRequiresModel && panelView !== "model-settings") {
    setPanelView("model-settings");
  }

  if (
    panelView === "model-settings" &&
    !showChat &&
    !showRequiresModel &&
    viewState !== "settings"
  ) {
    setPanelView("main");
  }

  const handleCloudConnect = useCallback(
    async (provider: string, model: string) => {
      setCloudConfig({ provider, model });
    },
    [],
  );

  const handleCloudDisconnect = useCallback(() => {
    setCloudConfig(null);
    cloudLLM.clearMessages();
  }, [cloudLLM]);

  const handleBackFromSettings = useCallback(() => {
    if (viewState === "settings") return;
    setPanelView("main");
  }, [viewState]);

  // ─── Gatekeeper: Prevent hydration race condition ──────────────

  if (viewState === "initializing" && mode === "local") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
          {vault ? (
            <CloudModelSettingsView
              vault={vault}
              onConnect={handleCloudConnect}
              error={cloudLLM.errorMessage}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
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

  if (
    viewState === "settings" ||
    showRequiresModel ||
    (panelView === "model-settings" && showChat)
  ) {
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
          onBack={viewState === "settings" ? undefined : handleBackFromSettings}
          isLoading={
            engineState.status === "downloading" ||
            engineState.status === "loading_vram"
          }
          onSwitchToCloud={() => setMode("cloud")}
          requiresModelWarning={viewState === "settings" || showRequiresModel}
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
