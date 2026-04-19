"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import type { WizardData } from "@hexagen/shared";
import type { DomainModelId, GovernanceEntry } from "@hexagen/local-llm";
import { useGovernanceAssistant } from "@/hooks/use-governance-assistant";
import { useLocalLLM } from "@/hooks/use-local-llm";
import { useCloudLLM, type UseCloudLLMConfig } from "@/hooks/use-cloud-llm";
import { useSecretVault } from "@/hooks/use-secret-vault";
import { getClientProviders } from "@/config/cloud-providers";
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
} from "@/lib/governance-question-templates";
import {
  Check,
  ChevronDown,
  Info,
  Lightbulb,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { Loader2 } from "lucide-react";
import { WakingUpCard } from "./WakingUpCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { ModelFooterIndicator } from "./ModelFooterIndicator";
import { ModelSettingsView } from "./ModelSettingsView";
import { UnavailableCard } from "./UnavailableCard";
import { CloudModelSettingsView } from "./CloudModelSettingsView";
import { CloudChatInterface } from "./CloudChatInterface";

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

const WIZARD_STEP_LABELS = [
  "Workspace",
  "Contexts",
  "Mappings",
  "Ports",
  "Export",
  "Summary",
];

function PanelHeader({
  onRefresh,
  isLoading,
}: {
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="px-5 pt-5 pb-4 flex-shrink-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck size={14} className="text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
            Governance
          </h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
          title="Refresh checks"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground font-normal pl-[38px]">
        Governance Assistant
      </p>
    </div>
  );
}

function GradientDivider() {
  return (
    <div className="h-px mx-5 bg-gradient-to-r from-transparent via-border to-transparent" />
  );
}

function StepPills({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <div className="px-2 py-4 flex-shrink-0">
      <div className="flex items-center gap-1.5 mb-3">
        {WIZARD_STEP_LABELS.map((label, i) => {
          const isActive = i === currentStepIndex;
          const isCompleted = i < currentStepIndex;
          return (
            <div
              key={label}
              className={[
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-default select-none",
                isActive
                  ? "bg-primary/15 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                  : isCompleted
                    ? "text-success"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
              ].join(" ")}
            >
              {isCompleted ? (
                <Check size={10} strokeWidth={3} />
              ) : (
                <span className="text-[10px] font-semibold">{i + 1}</span>
              )}
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusSummaryCard({
  violations,
  suggestions,
}: {
  violations: Violation[];
  suggestions: AISuggestion[];
}) {
  const violationCount = violations.length;
  const suggestionCount = suggestions.length;
  const hasIssues = violationCount > 0 || suggestionCount > 0;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="flex items-center gap-2.5">
        <div
          className={[
            "w-2 h-2 rounded-full",
            hasIssues
              ? "bg-destructive animate-soft-pulse"
              : "bg-success animate-soft-pulse",
          ].join(" ")}
        />
        <div>
          <p className="text-xs font-medium text-foreground">
            {hasIssues ? "Review Required" : "No Issues Found"}
          </p>
          {hasIssues && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {violationCount > 0 && <span>{violationCount} violation(s)</span>}
              {violationCount > 0 && suggestionCount > 0 && <span>, </span>}
              {suggestionCount > 0 && (
                <span>{suggestionCount} suggestion(s)</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({
  label,
  icon: Icon = Plus,
}: {
  label: string;
  icon?: React.ComponentType<{
    size: number;
    className: string;
    strokeWidth?: number;
  }>;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
        <Icon size={10} className="text-primary" strokeWidth={2.5} />
      </div>
      <h2 className="text-[13px] font-semibold text-foreground">{label}</h2>
    </div>
  );
}

function ViolationItem({
  violation,
  isSelected,
  onSelect,
}: {
  violation: Violation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const severityColor = {
    HIGH: "text-destructive",
    MEDIUM: "text-warning",
    LOW: "text-info",
  }[violation.severity];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full text-left rounded-lg border p-3 transition-all",
        isSelected
          ? "border-primary/30 bg-primary/[0.08]"
          : "border-border bg-muted/20 hover:bg-muted/40",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck
          size={14}
          className={`flex-shrink-0 mt-0.5 ${severityColor}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">
            {violation.message}
          </p>
          {violation.context && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {violation.context}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function SuggestionItem({
  suggestion,
  isSelected,
  onSelect,
}: {
  suggestion: AISuggestion;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full text-left rounded-lg border p-3 transition-all",
        isSelected
          ? "border-primary/30 bg-primary/[0.08]"
          : "border-border bg-muted/20 hover:bg-muted/40",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <Lightbulb size={14} className="flex-shrink-0 mt-0.5 text-accent" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">
            {suggestion.message}
          </p>
        </div>
      </div>
    </button>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-3">
      <p className="text-xs text-muted-foreground">Thinking</p>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block w-1 h-1 rounded-full bg-primary/60"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}

function QuestionAccordion({
  question,
  isExpanded,
  onToggle,
  disabled,
  children,
}: {
  question: PrebakedQuestion;
  isExpanded: boolean;
  onToggle: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={[
          "group w-full text-left border p-3.5 transition-all hover:-translate-y-px",
          isExpanded
            ? "rounded-t-xl rounded-b-none border-primary/30 bg-primary/[0.08]"
            : "rounded-xl border-card-border bg-muted/20 hover:bg-primary/5 hover:border-primary/25",
          disabled && "opacity-50 cursor-not-allowed",
        ].join(" ")}
      >
        <div className="flex items-start gap-3">
          <div
            className={[
              "mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
              isExpanded
                ? "bg-primary/20"
                : "bg-muted-foreground/15 group-hover:bg-primary/15",
            ].join(" ")}
          >
            <MessageSquare
              size={11}
              className={isExpanded ? "text-primary" : "text-muted-foreground"}
              strokeWidth={2}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className={[
                "text-[13px] leading-snug transition-colors mt-1",
                isExpanded
                  ? "text-primary font-medium"
                  : "text-foreground/80 group-hover:text-foreground",
              ].join(" ")}
            >
              {question.label}
            </p>
          </div>
          <ChevronDown
            size={12}
            className={[
              "mt-0.5 flex-shrink-0 transition-transform",
              isExpanded
                ? "rotate-180 text-primary"
                : "text-muted-foreground/60 group-hover:text-muted-foreground",
            ].join(" ")}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="bg-muted/5 border-t border-border p-4">{children}</div>
      )}
    </div>
  );
}

function AnswerArea({
  content,
  isRegenerating,
  onRegenerate,
  entryId,
  disabled,
}: {
  content: string;
  isRegenerating: boolean;
  onRegenerate: (id: string) => void;
  entryId: string;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-primary" />
          <p className="text-[13px] font-medium text-foreground leading-snug">
            AI Answer
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRegenerate(entryId)}
          disabled={disabled || isRegenerating}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Regenerate this answer"
        >
          <RotateCcw size={12} strokeWidth={2} />
        </button>
      </div>

      {isRegenerating ? (
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-primary" />
          <p className="text-xs text-foreground/60">Regenerating...</p>
        </div>
      ) : content ? (
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      ) : (
        <ThinkingIndicator />
      )}
    </div>
  );
}

function ThreadEntry({
  entry,
  isCurrentlyStreaming,
  streamingContent,
  isRegenerating,
  onRegenerate,
  disabled,
}: {
  entry: GovernanceEntry;
  isCurrentlyStreaming: boolean;
  streamingContent: string;
  isRegenerating: boolean;
  onRegenerate: (id: string) => void;
  disabled: boolean;
}) {
  const content = isCurrentlyStreaming ? streamingContent : entry.answer;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
          <MessageSquare size={10} className="text-primary" strokeWidth={2.5} />
        </div>
        <p className="text-[11px] font-medium text-primary">
          {entry.questionLabel}
        </p>
      </div>
      <AnswerArea
        content={content}
        isRegenerating={isRegenerating}
        onRegenerate={onRegenerate}
        entryId={entry.id}
        disabled={disabled}
      />
    </div>
  );
}

function FollowUpTag({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "bg-muted/20 border border-card-border text-foreground/80 hover:bg-primary/5 hover:border-primary/25 hover:text-primary",
      ].join(" ")}
    >
      <Sparkles size={10} />
      {label}
    </button>
  );
}

function PanelFooter({
  modelId,
  onOpenSettings,
  isLoading,
}: {
  modelId: DomainModelId | null;
  onOpenSettings: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex-shrink-0 p-2 border-t border-border bg-background">
      <div className="flex items-center justify-between gap-4 w-full">
        <div className="flex items-center gap-2">
          <Info size={12} className="text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground/60">
            Click a question to get an AI-powered answer
          </p>
        </div>
        <ModelFooterIndicator
          modelId={modelId}
          onOpenSettings={onOpenSettings}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
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
    engineState,
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
  } = useLocalLLM();

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const [mode, setMode] = useState<LLMMode>("local");
  const [cloudConfig, setCloudConfig] = useState<UseCloudLLMConfig | null>(
    null,
  );
  const autoNavigatedToSettings = useRef(false);

  const cloudLLM = useCloudLLM();
  const vault = useSecretVault();

  // Wire vault to cloudLLM hook when it becomes available
  useEffect(() => {
    if (vault) {
      cloudLLM.setVault(vault);
    }
  }, [vault, cloudLLM]);

  const { status, progress, errorMessage, autoLoading } = engineState;

  const handleOpenSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("model-settings");
  }, []);

  const handleBackFromSettings = useCallback(() => {
    if (llmEngineState.status === "requires_model") return;
    autoNavigatedToSettings.current = false;
    setPanelView("main");
  }, [llmEngineState.status]);

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

  // When model becomes ready after auto-navigation to settings
  useEffect(() => {
    if (llmEngineState.status === "ready" && autoNavigatedToSettings.current) {
      setPanelView("main");
      autoNavigatedToSettings.current = false;
    }
  }, [llmEngineState.status]);

  // Populate follow-up state from templates when streaming completes
  useEffect(() => {
    if (isStreaming) return;
    const hasCompletedAnswer = conversationThread.some((e) => e.answer !== "");
    if (hasCompletedAnswer) {
      setFollowUpQuestions(getFollowUpQuestions());
    }
  }, [isStreaming, getFollowUpQuestions, conversationThread]);

  // Clear follow-ups when context changes
  useEffect(() => {
    setFollowUpQuestions([]);
  }, [currentStepIndex, activeItem]);

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showRequiresModel = status === "requires_model";
  // Boot spinner shows while WebGPU is detected and Effect 2 resolves.
  // Effect 2 transitions fresh users to requires_model, so this spinner
  // appears briefly before the user lands in ModelSettingsView.
  const showBootSpinner =
    status === "unavailable" || status === "opt_in";

  // Cloud mode takes priority over local LLM lifecycle states.
  // Must be checked BEFORE early returns for boot spinners, opt-in cards, etc.
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
      <ModelSettingsView
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
                <ShieldCheck
                  size={10}
                  className="text-primary"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Governance Checks
              </span>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
              title="Refresh checks"
              aria-label="Refresh governance checks"
            >
              <RefreshCw
                size={14}
                className={isLoading ? "animate-spin" : ""}
              />
            </button>
          </div>
          <StatusSummaryCard
            violations={violations}
            suggestions={suggestions}
          />
        </div>

        <div className="mt-5">
          <SectionLabel label="Violations" icon={ShieldCheck} />
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
