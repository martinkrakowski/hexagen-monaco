"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useGovernanceAssistant } from "../hooks/useGovernanceAssistant";
import { useLocalLLM } from "@/llm-driver/useLocalLlm";
import { useCloudLLM } from "../hooks/useCloudLlm";
import { useCloudConnection } from "../hooks/useCloudConnection";
import { useSecretVault } from "@/lib/vault-context";
import { getClientProviders } from "@hexagen/local-llm";
import type { PrebakedQuestion } from "@hexagen/prompt-compiler";

import { StepPills, PanelFooter } from "../governance";

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
  } = useGovernanceAssistant(wizardData as any, currentStepIndex);

  const {
    messages,
    initializeModel,
    cancelDownload,
    engineState: llmEngineState,
    loadedModel,
    switchModel,
    deleteCachedModel,
    hasModelInCache,
  } = useLocalLLM();

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const [mode, setMode] = useState<LLMMode>("local");
  const autoNavigatedToSettings = useRef(false);

  const cloudLLM = useCloudLLM();
  const cloudConnection = useCloudConnection();
  const vault = useSecretVault();

  useEffect(() => {
    cloudLLM.setVault(vault);
  }, [cloudLLM, vault]);

  const { status, autoLoading } = llmEngineState;

  const handleOpenSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("model-settings");
  }, []);

  const handleBackFromSettings = useCallback(() => {
    if (status === "requires_model") return;
    autoNavigatedToSettings.current = false;
    setPanelView("main");
  }, [status]);

  const handleCloudConnect = useCallback(
    async (provider: string, model: string) => {
      await cloudConnection.connect(provider, model, vault);
    },
    [cloudConnection, vault],
  );

  const handleCloudDisconnect = useCallback(() => {
    cloudConnection.disconnect();
    cloudLLM.clearMessages();
  }, [cloudConnection, cloudLLM]);

  const handleRetryConnection = useCallback(() => {
    if (cloudConnection.error) {
      const lastProvider = cloudConnection.config?.provider;
      const lastModel = cloudConnection.config?.model;
      if (lastProvider && lastModel) {
        cloudConnection.retry(lastProvider, lastModel, vault);
      }
    }
  }, [cloudConnection, vault]);

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

  // Auto-navigate to settings if needed
  if (status === "requires_model" && panelView !== "model-settings") {
    setPanelView("model-settings");
    autoNavigatedToSettings.current = true;
  }

  if (
    panelView === "model-settings" &&
    status !== "ready" &&
    status !== "requires_model"
  ) {
    setPanelView("main");
    autoNavigatedToSettings.current = false;
  }

  // Show/hide state calculations
  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showRequiresModel = status === "requires_model";
  const showBootSpinner = status === "unavailable" || status === "opt_in";

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
        .find((p: any) => p.id === cloudConnection.config?.provider)
        ?.models.find((m: any) => m.id === cloudConnection.config?.model)
        ?.displayName ??
      cloudConnection.config?.model ??
      "Unknown Model";

    return (
      <ModeWrapper
        mode={mode}
        panelView={panelView}
        onModeChange={setMode}
        cloudConnectionState={cloudConnection.state as any}
        cloudConnectionError={cloudConnection.error}
        onCloudConnect={handleCloudConnect}
        onCloudDisconnect={handleCloudDisconnect}
        onRetryConnection={handleRetryConnection}
        cloudMessages={cloudLLM.messages as any}
        cloudLLMStatus={cloudLLM.status}
        cloudLLMError={cloudLLM.errorMessage}
        onSendMessage={(content) => {
          if (cloudConnection.config) {
            cloudLLM.sendMessage(content, cloudConnection.config);
          }
        }}
        onAbort={cloudLLM.abort}
        onClear={cloudLLM.clearMessages}
        modelName={modelName}
        llmEngineState={llmEngineState as any}
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
        onSwitchToCloud={() => {
          setMode("cloud");
          setPanelView("main");
        }}
        loadedModel={loadedModel}
        messagesLength={messages.length}
        onSwitchModel={switchModel as any}
        onDeleteModel={deleteCachedModel as any}
        hasModelInCache={hasModelInCache as any}
        onInitModel={initializeModel}
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
        onOpenSettings={handleOpenSettings}
        isLoading={
          llmEngineState.status === "downloading" ||
          llmEngineState.status === "loading_vram"
        }
      />
    </div>
  );
}
