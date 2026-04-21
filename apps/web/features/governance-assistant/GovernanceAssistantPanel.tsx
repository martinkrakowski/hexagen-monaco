"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { WizardData } from "@hexagen/shared";
import { useGovernanceAssistant } from "./hooks/useGovernanceAssistant";
import { useLocalLLM } from "@/hooks/useLocalLlm";
import { useCloudLLM, type UseCloudLLMConfig } from "./hooks/useCloudLlm";
import { useSecretVault } from "./hooks/useSecretVault";
import { getClientProviders } from "@/config/cloud-providers";
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
} from "@/lib/governance-question-templates";

import { WakingUpCard } from "./WakingUpCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { ModelSettingsView } from "./ModelSettingsView";
import { UnavailableCard } from "./UnavailableCard";
import { CloudModelSettingsView } from "./CloudModelSettingsView";
import { CloudChatInterface } from "./CloudChatInterface";

import {
  PanelHeader,
  GradientDivider,
  StepPills,
  StatusSummaryCard,
  SectionLabel,
  ViolationItem,
  SuggestionItem,
  ThinkingIndicator,
  QuestionAccordion,
  ThreadEntry,
  FollowUpTag,
  PanelFooter,
} from "./governance";

type PanelView = "main" | "model-settings";
type LLMMode = "local" | "cloud";

interface GovernanceAssistantPanelProps {
  wizardData: WizardData;
  currentStepIndex: number;
  violations: Violation[];
  suggestions: AISuggestion[];
  onRefresh: () => void;
  isLoading: boolean;
}

function LifecycleHeader({
  onRefresh,
  isLoading,
}: {
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-col">
      <PanelHeader onRefresh={onRefresh} isLoading={isLoading} />
      <GradientDivider />
    </div>
  );
}

function LifecycleCard({
  onRefresh,
  isLoading,
  children,
}: {
  onRefresh: () => void;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <LifecycleHeader onRefresh={onRefresh} isLoading={isLoading} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

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
  } = useGovernanceAssistant(wizardData, currentStepIndex);
  const {
    messages,
    initializeModel,
    cancelDownload,
    engineState: llmEngineState,
    loadedModel,
    switchModel,
    deleteCachedModel,
    hasModelInCache,
    returnToModelSettings,
  } = useLocalLLM();

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const prevStepIndexRef = useRef(currentStepIndex);
  const prevActiveItemRef = useRef(activeItem);
  const [mode, setMode] = useState<LLMMode>("local");
  const [cloudConfig, setCloudConfig] = useState<UseCloudLLMConfig | null>(
    null,
  );
  const autoNavigatedToSettings = useRef(false);

  const cloudLLM = useCloudLLM();
  const vault = useSecretVault();

  if (vault) {
    cloudLLM.setVault(vault);
  }

  const { status, progress, errorMessage, autoLoading } = llmEngineState;

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
      setCloudConfig({ provider, model });
    },
    [],
  );

  const handleCloudDisconnect = useCallback(() => {
    setCloudConfig(null);
    cloudLLM.clearMessages();
  }, [cloudLLM]);

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

  if (
    prevStepIndexRef.current !== currentStepIndex ||
    prevActiveItemRef.current !== activeItem
  ) {
    prevStepIndexRef.current = currentStepIndex;
    prevActiveItemRef.current = activeItem;
    setFollowUpQuestions([]);
  }

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showRequiresModel = status === "requires_model";
  const showBootSpinner = status === "unavailable" || status === "opt_in";

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
          <div className="flex-1 min-h-0">
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
          <PanelFooter showHint={false} />
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
        <div className="flex-1 min-h-0">
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
        <PanelFooter showHint={false} />
      </div>
    );
  }

  if (showBootSpinner) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (showUnavailable) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <UnavailableCard
            status={status as "no_webgpu" | "unsupported_browser"}
          />
        </LifecycleCard>
      </div>
    );
  }

  if (showWakingUp) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <WakingUpCard onCancel={cancelDownload} />
        </LifecycleCard>
      </div>
    );
  }

  if (showProgress || showError) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <ModelProgressCard
            status={status}
            progress={progress}
            errorMessage={errorMessage}
            onCancel={returnToModelSettings}
            onRetry={() => initializeModel()}
            model={loadedModel}
            modelId={llmEngineState.loadedModelId ?? undefined}
          />
        </LifecycleCard>
      </div>
    );
  }

  const handleQuestionClick = (q: PrebakedQuestion) => {
    expandAccordion(q.id);
  };

  const handleFollowUpClick = (q: PrebakedQuestion) => {
    setFollowUpQuestions([]);
    if (activeItem) {
      askQuestion(q);
    } else {
      askStepQuestion(q);
    }
  };

  if (showRequiresModel && panelView !== "model-settings") {
    setPanelView("model-settings");
    autoNavigatedToSettings.current = true;
  }

  if (
    panelView === "model-settings" &&
    status !== "ready" &&
    !showRequiresModel
  ) {
    setPanelView("main");
    autoNavigatedToSettings.current = false;
  }

  if (
    panelView === "model-settings" &&
    (status === "ready" || showRequiresModel)
  ) {
    return (
      <div className="flex flex-col h-full">
        <ModelSettingsView
          key={llmEngineState.loadedModelId ?? "none"}
          currentModelId={llmEngineState.loadedModelId}
          loadedModel={loadedModel}
          messagesLength={messages.length}
          onSwitchModel={switchModel}
          onDeleteModel={deleteCachedModel}
          hasModelInCache={hasModelInCache}
          onBack={handleBackFromSettings}
          isLoading={
            llmEngineState.status === "downloading" ||
            llmEngineState.status === "loading_vram"
          }
          onSwitchToCloud={() => {
            setMode("cloud");
            setPanelView("main");
          }}
          requiresModelWarning={showRequiresModel}
        />
        <PanelFooter showHint={false} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      <StepPills currentStepIndex={currentStepIndex} />
      <div className="h-px mx-5 mb-3 bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5">
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
                <span
                  className="text-primary font-bold"
                  style={{ fontSize: "12px" }}
                >
                  G
                </span>
              </div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Governance Checks
              </span>
            </div>
          </div>
          <StatusSummaryCard
            violations={violations}
            suggestions={suggestions}
          />
        </div>

        <div className="mt-5">
          <SectionLabel label="Violations" />
          {violations.length > 0 && (
            <div className="space-y-2 mt-4">
              {violations.map((v) => (
                <ViolationItem
                  key={v.id}
                  violation={v}
                  isSelected={
                    activeItem?.type === "violation" &&
                    activeItem.item.id === v.id
                  }
                  onSelect={() => selectItem({ type: "violation", item: v })}
                />
              ))}
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="space-y-2 mt-4">
            {suggestions.map((s) => (
              <SuggestionItem
                key={s.id}
                suggestion={s}
                isSelected={
                  activeItem?.type === "suggestion" &&
                  activeItem.item.id === s.id
                }
                onSelect={() => selectItem({ type: "suggestion", item: s })}
              />
            ))}
          </div>
        )}

        <div className="mt-5">
          <SectionLabel
            label={activeItem ? "Item Questions" : "Step Questions"}
          />
          <div className="space-y-3">
            {displayQuestions.map((q) => {
              const isExpanded = expandedQuestionId === q.id;
              const isCurrentlyStreaming =
                isStreaming &&
                isExpanded &&
                conversationThread.length > 0 &&
                !conversationThread[conversationThread.length - 1].answer;

              return (
                <QuestionAccordion
                  key={q.id}
                  question={q}
                  isExpanded={isExpanded}
                  onToggle={() => handleQuestionClick(q)}
                  disabled={isStreaming}
                >
                  {threadLoaded && (
                    <>
                      {conversationThread.length === 0 && <ThinkingIndicator />}
                      {conversationThread.length > 0 && (
                        <div className="space-y-4 mb-4">
                          {conversationThread.map((entry, i) => {
                            const isRegenerating =
                              regeneratingEntryId === entry.id;
                            return (
                              <ThreadEntry
                                key={entry.id}
                                entry={entry}
                                isCurrentlyStreaming={
                                  isCurrentlyStreaming &&
                                  i === conversationThread.length - 1
                                }
                                streamingContent={lastAssistantMessage}
                                isRegenerating={isRegenerating}
                                onRegenerate={regenerateAnswer}
                                disabled={isStreaming}
                              />
                            );
                          })}
                        </div>
                      )}

                      {followUpQuestions.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60 mb-2">
                            Follow-up Questions
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {followUpQuestions.map((q) => (
                              <FollowUpTag
                                key={q.id}
                                label={q.label}
                                onClick={() => handleFollowUpClick(q)}
                                disabled={isStreaming}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </QuestionAccordion>
              );
            })}
          </div>
        </div>
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
