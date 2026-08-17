"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useGovernanceAssistant } from "../hooks/useGovernanceAssistant";
import {
  useLocalLLMConfig,
  useLocalLLMStreaming,
} from "@/lib/local-llm-context";
import { useCloudLLM } from "../hooks/useCloudLlm";
import { useCloudConnection } from "../hooks/useCloudConnection";
import { useServerCapabilities } from "../hooks/useServerCapabilities";
import { useSecretVault } from "@/lib/vault-context";
import { getClientProviders } from "@hexagen/local-llm";
import type { PrebakedQuestion } from "@hexagen/prompt-compiler";
import type { WizardData } from "@hexagen/project-configuration";
import type {
  ClientProviderInfo,
  CloudModelConfig,
  DomainModelId,
} from "@hexagen/local-llm";
import { hasServerLLMAccessKey } from "../../../app/lib/wire";

import { ModeWrapper } from "./view/ModeWrapper";
import { GovernanceQaView } from "./view/GovernanceQaView";
import { selectLocalLifecycle, lifecycleOwnsThePanel } from "./lifecycle";
import type {
  GovernanceAssistantPanelProps,
  PanelView,
  LLMMode,
} from "./types";
import type { CloudChatMessage } from "../hooks/useCloudLlm";
import type { ConnectionState } from "../hooks/useCloudConnection";

/**
 * Transport boundary for the governance assistant (REA-001).
 *
 * Everything that talks to the outside world lives here — the local engine
 * subscription, the cloud connection and chat transport, the secret vault, the
 * server capability probe, and the Q&A thread hook — and leaves as plain props.
 * `view/` renders; it holds no transport, and a lint fence on that directory
 * keeps it that way.
 *
 * The panel's own state is view routing: `mode` (local vs cloud) and
 * `panelView` (Q&A vs model settings). That is this slice's equivalent of the
 * prop-injected router used elsewhere in `apps/web` — the children receive the
 * current destination and raise navigation intents, they never decide where to
 * go.
 */
export function GovernanceAssistantPanel({
  wizardData,
  currentStepIndex,
  violations,
  suggestions,
}: GovernanceAssistantPanelProps) {
  // `onRefresh` and `isLoading` are deliberately not destructured: nothing in
  // this panel reads them. They were threaded through `ModeWrapper` and
  // `LocalModeView` to no consumer at all, which also means
  // `GovernancePanelWrapper`'s `handleRefresh` — the ONLY caller of
  // `useGovernanceData().refresh`, and therefore the only thing that would ever
  // populate `violations` / `suggestions` — is never invoked. Both props stay on
  // the interface because deciding what that surface should do is a product
  // question, not a refactor; see the PR notes.
  const {
    activeItem,
    selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    getFollowUpQuestions,
    conversationThread,
    stepQuestions,
    isStreaming,
    expandedQuestionId,
    expandAccordion,
    regeneratingEntryId,
    regenerateAnswer,
    threadLoaded,
  } = useGovernanceAssistant(wizardData as WizardData, currentStepIndex);

  const { messages } = useLocalLLMStreaming();

  const {
    initializeModel,
    cancelDownload,
    engineState: llmEngineState,
    loadedModel,
    switchModel,
    deleteCachedModel,
    hasModelInCache,
    resetLocalAIConfig,
    returnToModelSettings,
  } = useLocalLLMConfig();

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const [mode, setMode] = useState<LLMMode>("local");
  const autoNavigatedToSettings = useRef(false);

  // The panel's only capability probe. Both the footer label and the settings
  // card read the names from here (REA-006).
  const capabilities = useServerCapabilities();

  const cloudLLM = useCloudLLM();
  const cloudConnection = useCloudConnection();
  const vault = useSecretVault();

  const cloudConnectionRef = useRef(cloudConnection);
  cloudConnectionRef.current = cloudConnection;
  const cloudLLMRef = useRef(cloudLLM);
  cloudLLMRef.current = cloudLLM;

  useEffect(() => {
    cloudLLM.setVault(vault);
  }, [cloudLLM, vault]);

  const { status } = llmEngineState;
  const serverAssistantAvailable = hasServerLLMAccessKey();
  const lifecycle = selectLocalLifecycle(
    llmEngineState,
    serverAssistantAvailable,
  );

  const handleOpenSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("model-settings");
  }, []);

  const handleBackFromSettings = useCallback(() => {
    if (status === "requires_model" && !serverAssistantAvailable) return;
    autoNavigatedToSettings.current = false;
    setPanelView("main");
  }, [status, serverAssistantAvailable]);

  const handleCloudConnect = useCallback(
    async (provider: string, model: string) => {
      await cloudConnectionRef.current.connect(provider, model, vault);
    },
    [vault],
  );

  const handleCloudDisconnect = useCallback(() => {
    cloudConnectionRef.current.disconnect();
    cloudLLMRef.current.clearMessages();
  }, []);

  const handleRetryConnection = useCallback(() => {
    const cc = cloudConnectionRef.current;
    if (cc.error) {
      const lastProvider = cc.config?.provider;
      const lastModel = cc.config?.model;
      if (lastProvider && lastModel) {
        cc.retry(lastProvider, lastModel, vault);
      }
    }
  }, [vault]);

  const handleSendMessage = useCallback((content: string) => {
    const config = cloudConnectionRef.current.config;
    if (config) {
      cloudLLMRef.current.sendMessage(content, config);
    }
  }, []);

  const handleSwitchToCloud = useCallback(() => {
    setMode("cloud");
    setPanelView("main");
  }, []);

  const handleResetConfig = useCallback(() => {
    resetLocalAIConfig();
    returnToModelSettings();
  }, [resetLocalAIConfig, returnToModelSettings]);

  const questions = useMemo(() => getQuestions(), [getQuestions]);
  const displayQuestions = activeItem ? questions : stepQuestions;

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].content;
      }
    }
    return "";
  }, [messages]);

  useEffect(() => {
    if (status === "ready" && autoNavigatedToSettings.current) {
      setPanelView("main");
      autoNavigatedToSettings.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (isStreaming) return;
    const hasCompletedAnswer = conversationThread.some((e) => e.answer !== "");
    if (hasCompletedAnswer) {
      setFollowUpQuestions(getFollowUpQuestions());
    }
  }, [isStreaming, getFollowUpQuestions, conversationThread]);

  const handleQuestionClick = useCallback(
    (q: PrebakedQuestion) => {
      expandAccordion(q.id);
    },
    [expandAccordion],
  );

  const handleFollowUpClick = useCallback(
    (q: PrebakedQuestion) => {
      setFollowUpQuestions([]);
      if (activeItem) {
        askQuestion(q);
      } else {
        askStepQuestion(q);
      }
    },
    [activeItem, askQuestion, askStepQuestion],
  );

  useEffect(() => {
    if (
      status === "requires_model" &&
      !serverAssistantAvailable &&
      panelView !== "model-settings"
    ) {
      setPanelView("model-settings");
      autoNavigatedToSettings.current = true;
    }
  }, [status, panelView, serverAssistantAvailable]);

  useEffect(() => {
    if (
      panelView === "model-settings" &&
      status !== "ready" &&
      status !== "requires_model"
    ) {
      setPanelView("main");
      autoNavigatedToSettings.current = false;
    }
  }, [panelView, status]);

  const engineBusy = status === "downloading" || status === "loading_vram";

  if (
    lifecycleOwnsThePanel(lifecycle) ||
    panelView === "model-settings" ||
    mode === "cloud"
  ) {
    const providers = getClientProviders();
    const modelName =
      providers
        .find(
          (p: ClientProviderInfo) => p.id === cloudConnection.config?.provider,
        )
        ?.models.find(
          (m: CloudModelConfig) => m.id === cloudConnection.config?.model,
        )?.displayName ??
      cloudConnection.config?.model ??
      "Unknown Model";

    return (
      <ModeWrapper
        mode={mode}
        vault={vault}
        onModeChange={setMode}
        cloudConnectionState={cloudConnection.state as ConnectionState}
        cloudConnectionError={cloudConnection.error}
        onCloudConnect={handleCloudConnect}
        onCloudDisconnect={handleCloudDisconnect}
        onRetryConnection={handleRetryConnection}
        cloudMessages={cloudLLM.messages as CloudChatMessage[]}
        cloudLLMStatus={cloudLLM.status}
        cloudLLMError={cloudLLM.errorMessage}
        onSendMessage={handleSendMessage}
        onAbort={cloudLLM.abort}
        onClear={cloudLLM.clearMessages}
        modelName={modelName}
        lifecycle={lifecycle}
        isLoading={engineBusy}
        capabilities={capabilities}
        serverAssistantAvailable={serverAssistantAvailable}
        loadedModel={loadedModel}
        loadedModelId={llmEngineState.loadedModelId}
        messagesLength={messages.length}
        onCancelDownload={cancelDownload}
        onOpenSettings={handleOpenSettings}
        onInitModel={initializeModel}
        onBackFromSettings={handleBackFromSettings}
        onSwitchToCloud={handleSwitchToCloud}
        onSwitchModel={switchModel as (modelId: DomainModelId) => Promise<void>}
        onDeleteModel={
          deleteCachedModel as (modelId: DomainModelId) => Promise<void>
        }
        hasModelInCache={
          hasModelInCache as (modelId: DomainModelId) => Promise<boolean>
        }
        onResetConfig={handleResetConfig}
      />
    );
  }

  return (
    <GovernanceQaView
      currentStepIndex={currentStepIndex}
      violations={violations}
      suggestions={suggestions}
      activeItem={activeItem}
      onSelectViolation={(v) => selectItem({ type: "violation", item: v })}
      onSelectSuggestion={(s) => selectItem({ type: "suggestion", item: s })}
      displayQuestions={displayQuestions}
      isStreaming={isStreaming}
      isExpanded={(id) => expandedQuestionId === id}
      onQuestionClick={handleQuestionClick}
      conversationThread={conversationThread}
      lastAssistantMessage={lastAssistantMessage}
      regeneratingEntryId={regeneratingEntryId}
      onRegenerate={regenerateAnswer}
      followUpQuestions={followUpQuestions}
      onFollowUpClick={handleFollowUpClick}
      threadLoaded={threadLoaded}
      footerModelId={llmEngineState.loadedModelId}
      footerModelLabel={
        serverAssistantAvailable ? capabilities.chatModelName : undefined
      }
      footerIsLoading={engineBusy}
      onOpenSettings={handleOpenSettings}
    />
  );
}
