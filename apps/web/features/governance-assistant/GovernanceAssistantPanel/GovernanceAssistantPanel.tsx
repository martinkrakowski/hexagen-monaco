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
import {
  LocalStorageTandemConfigAdapter,
  TandemTriggerDetectionUseCase,
  DEFAULT_TANDEM_CONFIG,
} from "@hexagen/tandem-execution";
import type {
  LocalModelState,
  ConnectionHealthState,
} from "@hexagen/tandem-execution";
import { TandemInterceptionModal } from "@hexagen/model-settings";
import { StepPills, PanelFooter } from "../governance";
import { hasServerLLMAccessKey } from "../../../app/lib/wire";
import { getCapabilities } from "@/lib/manifest-generation";
import { useTandemLlm } from "../hooks/useTandemLlm";
import { writeTandemConfigSentinel } from "../hooks/useTandemLostConfig";

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

  // ── Tandem infrastructure ──────────────────────────────────────────────────
  const triggerDetection = useMemo(
    () => new TandemTriggerDetectionUseCase(),
    [],
  );
  const configAdapter = useMemo(
    () => new LocalStorageTandemConfigAdapter(),
    [],
  );

  const [tandemModalOpen, setTandemModalOpen] = useState(false);
  const [isFirstTimeTandem, setIsFirstTimeTandem] = useState(() => {
    const result = new LocalStorageTandemConfigAdapter().read();
    return result.success ? !result.value.firstTimeExperienceDismissed : true;
  });

  const prevCloudStateRef = useRef<ConnectionHealthState>("UNVALIDATED");

  const tandemLlm = useTandemLlm();

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

  // ── State mappers ──────────────────────────────────────────────────────────
  const mapToLocalModelState = useCallback((s: string): LocalModelState => {
    switch (s) {
      case "ready":
        return "ACTIVE";
      case "loading_vram":
        return "LOADING";
      case "downloading":
        return "DOWNLOADING";
      case "requires_model":
      case "unavailable":
      case "no_webgpu":
      case "unsupported_browser":
      case "opt_in":
        return "NOT_DOWNLOADED";
      case "error":
        return "ERROR";
      default:
        return "NOT_DOWNLOADED";
    }
  }, []);

  const mapToCloudHealthState = useCallback(
    (s: string): ConnectionHealthState => {
      switch (s) {
        case "connected":
          return "VALID";
        case "error":
          return "UNAVAILABLE";
        case "connecting":
        case "idle":
        default:
          return "UNVALIDATED";
      }
    },
    [],
  );

  const mappedLocalState = mapToLocalModelState(llmEngineState.status);
  const mappedCloudState = mapToCloudHealthState(cloudConnection.state);

  // ── Forward trigger: watch local model state transitions ──────────────────
  useEffect(() => {
    const mapped = mapToLocalModelState(llmEngineState.status);
    if (mapped === "DOWNLOADED" && !tandemModalOpen) {
      const cloudMapped = mapToCloudHealthState(cloudConnection.state);
      if (triggerDetection.checkForwardTrigger(mapped, cloudMapped)) {
        setTandemModalOpen(true);
      }
    }
  }, [llmEngineState.status]); // intentional: only re-run on status change

  // ── Reverse trigger: watch cloud connection state transitions ─────────────
  useEffect(() => {
    const currentCloudState = mapToCloudHealthState(cloudConnection.state);
    const prevCloudState = prevCloudStateRef.current;
    const localMapped = mapToLocalModelState(llmEngineState.status);

    if (
      !tandemModalOpen &&
      triggerDetection.checkReverseTrigger(
        localMapped,
        prevCloudState,
        currentCloudState,
      )
    ) {
      setTandemModalOpen(true);
    }

    prevCloudStateRef.current = currentCloudState;
  }, [cloudConnection.state]); // intentional: only re-run on state change

  // ── Tandem modal handlers ─────────────────────────────────────────────────
  const handleTandemPathSelect = useCallback(
    (path: "local-only" | "tandem" | "keep-current") => {
      const configResult = configAdapter.read();
      const config = configResult.success
        ? configResult.value
        : DEFAULT_TANDEM_CONFIG;
      triggerDetection.commitActivation(path, config, configAdapter);

      if (path === "tandem") {
        setMode("tandem");
      } else if (path === "local-only") {
        setMode("local");
      }
      setTandemModalOpen(false);
    },
    [triggerDetection, configAdapter],
  );

  const handleFirstTimeDismiss = useCallback(() => {
    const configResult = configAdapter.read();
    const config = configResult.success
      ? configResult.value
      : DEFAULT_TANDEM_CONFIG;
    configAdapter.write({ ...config, firstTimeExperienceDismissed: true });
    setIsFirstTimeTandem(false);
  }, [configAdapter]);

  // ── Startup validation: derive tandem status ──────────────────────────────
  const derivedTandemStatus = useMemo(():
    | "active"
    | "degraded"
    | "unavailable"
    | "off" => {
    const configResult = configAdapter.read();
    if (!configResult.success || !configResult.value.enabled) return "off";
    if (mappedLocalState === "ACTIVE" && mappedCloudState === "VALID")
      return "active";
    if (mappedCloudState === "UNAVAILABLE" || mappedLocalState === "ERROR")
      return "unavailable";
    if (mappedCloudState === "DEGRADED") return "degraded";
    return "off";
  }, [configAdapter, mappedLocalState, mappedCloudState]);

  // ── onTandemDisabled: switch mode back when tandem config reset ───────────
  const handleTandemDisabled = useCallback(() => {
    if (cloudConnection.state === "connected") {
      setMode("cloud");
    } else {
      setMode("local");
    }
  }, [cloudConnection.state]);

  // ── Tandem sendMessage wrapper ────────────────────────────────────────────
  const handleSendTandemMessage = useCallback(
    async (params: {
      content: string;
      conversationId: string;
      localModelState: LocalModelState;
      cloudHealthState: ConnectionHealthState;
      byokCiphertext?: string;
      byokProvider?: string;
      cloudContextLimit?: number;
    }) => {
      await tandemLlm.sendMessage({
        ...params,
        localModelState: mappedLocalState,
        cloudHealthState: mappedCloudState,
      });
    },
    [tandemLlm, mappedLocalState, mappedCloudState],
  );

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
    mode === "cloud" ||
    mode === "tandem"
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

    const isByok =
      !hasServerLLMAccessKey() && cloudConnection.state === "connected";

    const cloudProviderName =
      getClientProviders().find(
        (p: ClientProviderInfo) => p.id === cloudConnection.config?.provider,
      )?.displayName ??
      cloudConnection.config?.provider ??
      "Cloud";

    return (
      <>
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
          onSwitchModel={
            switchModel as (modelId: DomainModelId) => Promise<void>
          }
          onDeleteModel={
            deleteCachedModel as (modelId: DomainModelId) => Promise<void>
          }
          hasModelInCache={
            hasModelInCache as (modelId: DomainModelId) => Promise<boolean>
          }
          onInitModel={initializeModel}
          onResetConfig={handleResetConfig}
          onConfigSaved={writeTandemConfigSentinel}
          onTandemDisabled={handleTandemDisabled}
          tandemDerivedStatus={derivedTandemStatus}
          tandemMessages={tandemLlm.messages}
          tandemStatus={tandemLlm.status}
          onSendTandemMessage={handleSendTandemMessage}
          onAbortTandem={tandemLlm.abort}
          onClearTandem={tandemLlm.clear}
          tandemCurrentStage={tandemLlm.currentStage}
          onStageAwareAbortTandem={tandemLlm.stageAwareAbort}
          tandemCanRetry={tandemLlm.canRetry}
          onRetryCloudRefinement={tandemLlm.retryCloudRefinement}
          tandemLastBypassReason={tandemLlm.lastBypassReason}
          tandemLastResponseWasPartial={tandemLlm.lastResponseWasPartial}
          tandemLastErrorType={tandemLlm.lastErrorType}
          tandemHasOomEvent={tandemLlm.hasOomEvent}
          onClearBypassReason={tandemLlm.clearBypassReason}
        />
        <TandemInterceptionModal
          isOpen={tandemModalOpen}
          localModelName={loadedModel?.name ?? "Local Model"}
          cloudProviderName={cloudProviderName}
          isByok={isByok}
          isFirstTime={isFirstTimeTandem}
          currentSetupDescription={
            mode === "cloud"
              ? "Continue using Cloud Only"
              : "Continue using Local Only"
          }
          onSelectPath={handleTandemPathSelect}
          onCancel={() => setTandemModalOpen(false)}
          onFirstTimeDismiss={handleFirstTimeDismiss}
        />
      </>
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
