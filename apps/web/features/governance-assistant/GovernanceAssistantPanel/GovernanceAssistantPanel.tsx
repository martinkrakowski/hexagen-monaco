"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useGovernanceAssistant } from "../hooks/useGovernanceAssistant";
import {
  useLocalLLMConfig,
  useLocalLLMStreaming,
} from "@/llm-driver/useLocalLlm";
import { useCloudLLM } from "../hooks/useCloudLlm";
import { useCloudConnection } from "../hooks/useCloudConnection";
import { useSecretVault } from "@/lib/vault-context";
import { getClientProviders } from "@hexagen/local-llm";
import type { PrebakedQuestion } from "@hexagen/prompt-compiler";
import type { WizardData } from "@hexagen/project-configuration";
import type {
  ClientProviderInfo,
  CloudModelConfig,
  DomainModelId,
} from "@hexagen/local-llm";
import { StepPills, PanelFooter } from "../governance";
import { hasServerLLMAccessKey } from "../../../app/lib/wire";
import { getCapabilities } from "@/lib/manifest-generation";

import { StatusSection } from "./StatusSection";
import { ViolationsSection } from "./ViolationsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { QuestionsSection } from "./QuestionsSection";
import { ModeWrapper } from "./ModeWrapper";
import type {
  GovernanceAssistantPanelProps,
  PanelView,
  LLMMode,
} from "./types";
import type { CloudChatMessage } from "../hooks/useCloudLlm";
import type { ConnectionState } from "../hooks/useCloudConnection";

export function GovernanceAssistantPanel({
  wizardData,
  currentStepIndex,
  violations,
  suggestions,
  onRefresh,
  isLoading,
}: GovernanceAssistantPanelProps) {
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
  const [serverModelName, setServerModelName] = useState<string>("gpt-4o-mini");

  useEffect(() => {
    getCapabilities()
      .then((res) => {
        if (res.activeModelName) {
          setServerModelName(res.activeModelName);
        }
      })
      .catch(() => {});
  }, []);

  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const [mode, setMode] = useState<LLMMode>("local");
  const autoNavigatedToSettings = useRef(false);

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

  const { status, autoLoading } = llmEngineState;

  const handleOpenSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("model-settings");
  }, []);

  const handleBackFromSettings = useCallback(() => {
    if (status === "requires_model" && !hasServerLLMAccessKey()) return;
    autoNavigatedToSettings.current = false;
    setPanelView("main");
  }, [status]);

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
  }, [returnToModelSettings]);

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
    if (llmEngineState.status === "ready" && autoNavigatedToSettings.current) {
      setPanelView("main");
      autoNavigatedToSettings.current = false;
    }
  }, [llmEngineState.status]);

  useEffect(() => {
    if (isStreaming) return;
    const hasCompletedAnswer = conversationThread.some((e) => e.answer !== "");
    if (hasCompletedAnswer) {
      setFollowUpQuestions(getFollowUpQuestions());
    }
  }, [isStreaming, getFollowUpQuestions, conversationThread]);

  // Handle question click
  const handleQuestionClick = useCallback(
    (q: PrebakedQuestion) => {
      expandAccordion(q.id);
    },
    [expandAccordion],
  );

  // Handle follow-up click
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
      !hasServerLLMAccessKey() &&
      panelView !== "model-settings"
    ) {
      setPanelView("model-settings");
      autoNavigatedToSettings.current = true;
    }
  }, [status, panelView]);

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

  // Show/hide state calculations
  const showUnavailable =
    (status === "no_webgpu" || status === "unsupported_browser") &&
    !hasServerLLMAccessKey();
  const showWakingUp =
    status === "loading_vram" && autoLoading && !hasServerLLMAccessKey();
  const showProgress =
    (status === "downloading" || (status === "loading_vram" && !autoLoading)) &&
    !hasServerLLMAccessKey();
  const showError = status === "error" && !hasServerLLMAccessKey();
  const showRequiresModel =
    status === "requires_model" && !hasServerLLMAccessKey();
  const showBootSpinner =
    (status === "unavailable" || status === "opt_in") &&
    !hasServerLLMAccessKey();

  // Handle mode wrapper states
  if (
    showBootSpinner ||
    showUnavailable ||
    showWakingUp ||
    showProgress ||
    showError ||
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
        panelView={panelView}
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
        llmEngineState={llmEngineState}
        showBootSpinner={showBootSpinner}
        showUnavailable={showUnavailable}
        showWakingUp={showWakingUp}
        showProgress={showProgress}
        showError={showError}
        showRequiresModel={showRequiresModel}
        onRefresh={onRefresh}
        isLoading={isLoading}
        onCancelDownload={cancelDownload}
        onOpenSettings={handleOpenSettings}
        onBackFromSettings={handleBackFromSettings}
        onSwitchToCloud={handleSwitchToCloud}
        loadedModel={loadedModel}
        messagesLength={messages.length}
        onSwitchModel={switchModel as (modelId: DomainModelId) => Promise<void>}
        onDeleteModel={
          deleteCachedModel as (modelId: DomainModelId) => Promise<void>
        }
        hasModelInCache={
          hasModelInCache as (modelId: DomainModelId) => Promise<boolean>
        }
        onInitModel={initializeModel}
        onResetConfig={handleResetConfig}
      />
    );
  }

  // Main view
  return (
    <div className="h-full flex flex-col bg-card">
      <StepPills currentStepIndex={currentStepIndex} />
      <div className="h-px mx-5 mb-3 bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5">
        <StatusSection violations={violations} suggestions={suggestions} />
        <ViolationsSection
          violations={violations}
          activeItem={activeItem}
          onSelectViolation={(v) => selectItem({ type: "violation", item: v })}
        />
        <SuggestionsSection
          suggestions={suggestions}
          activeItem={activeItem}
          onSelectSuggestion={(s) =>
            selectItem({ type: "suggestion", item: s })
          }
        />
        <QuestionsSection
          displayQuestions={displayQuestions}
          activeItem={activeItem}
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
        />
      </div>

      <PanelFooter
        modelId={llmEngineState.loadedModelId}
        modelLabel={hasServerLLMAccessKey() ? serverModelName : undefined}
        onOpenSettings={handleOpenSettings}
        isLoading={
          llmEngineState.status === "downloading" ||
          llmEngineState.status === "loading_vram"
        }
      />
    </div>
  );
}
