"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { WizardData } from "@hexagen/shared";
import type { DomainModelId } from "@hexagen/local-llm";
import { useGovernanceAssistant } from "@/hooks/use-governance-assistant";
import { useLocalLLM } from "@/hooks/use-local-llm";
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
} from "lucide-react";
import { Loader2 } from "lucide-react";
import { OptInCard } from "./OptInCard";
import { WakingUpCard } from "./WakingUpCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { ModelFooterIndicator } from "./ModelFooterIndicator";
import { ModelSettingsView } from "./ModelSettingsView";
import { UnavailableCard } from "./UnavailableCard";

const HAS_ENABLED_KEY = "hexagen:local-llm:has-enabled";
const AUTO_LOAD_KEY = "hexagen:local-llm:auto-load";
const OPT_OUT_KEY = "hexagen:local-llm:opted-out";

type PanelView = "main" | "model-settings";

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
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
          Current Step
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
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
                <span className="text-muted-foreground/60">{i + 1}</span>
              )}
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type StatusKind = "clear" | "warning" | "violation";

function StatusSummaryCard({
  violations,
  suggestions,
}: {
  violations: Violation[];
  suggestions: AISuggestion[];
}) {
  const hasViolation = violations.length > 0;
  const hasWarning = suggestions.length > 0;

  let kind: StatusKind = "clear";
  let title = "All clear";
  let desc = "No violations or suggestions for this step.";

  if (hasViolation) {
    kind = "violation";
    title = `${violations.length} violation${violations.length > 1 ? "s" : ""} found`;
    desc = violations[0].message;
  } else if (hasWarning) {
    kind = "warning";
    title = `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""}`;
    desc = suggestions[0].message;
  }

  const cardClasses =
    kind === "violation"
      ? "rounded-xl border border-destructive/15 bg-destructive/5 p-4"
      : kind === "warning"
        ? "rounded-xl border border-warning/15 bg-warning/5 p-4"
        : "rounded-xl border border-card-border bg-muted/40 p-4";

  const dotClasses =
    kind === "violation"
      ? "w-2 h-2 rounded-full bg-destructive animate-soft-pulse"
      : kind === "warning"
        ? "w-2 h-2 rounded-full bg-warning animate-soft-pulse"
        : "w-2 h-2 rounded-full bg-success animate-soft-pulse";

  return (
    <div className={cardClasses}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <div className={dotClasses} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground leading-snug">
            {title}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            {desc}
          </p>
        </div>
      </div>
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
    HIGH: "bg-destructive",
    MEDIUM: "bg-warning",
    LOW: "bg-info",
  }[violation.severity];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full text-left rounded-xl border p-3 transition-all hover:-translate-y-px",
        isSelected
          ? "border-primary/30 bg-primary/10 hover:bg-primary/15"
          : "border-card-border bg-muted/20 hover:bg-primary/5 hover:border-primary/25",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${severityColor}`}
        />
        <div className="flex-1 min-w-0">
          <p
            className={`text-[13px] leading-snug transition-colors ${isSelected ? "text-primary font-medium" : "text-foreground/80"}`}
          >
            {violation.message}
          </p>
          {violation.context && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
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
        "w-full text-left rounded-xl border p-3 transition-all hover:-translate-y-px",
        isSelected
          ? "border-primary/30 bg-primary/10 hover:bg-primary/15"
          : "border-card-border bg-muted/20 hover:bg-primary/5 hover:border-primary/25",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <Lightbulb className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p
            className={`text-[13px] leading-snug transition-colors ${isSelected ? "text-primary font-medium" : "text-foreground/80"}`}
          >
            {suggestion.message}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{suggestion.category}</span>
            <span>•</span>
            <span>{Math.round(suggestion.confidence * 100)}% confident</span>
          </div>
        </div>
      </div>
    </button>
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
    strokeWidth: number;
  }>;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
        <Icon size={10} className="text-primary" strokeWidth={2.5} />
      </div>
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
    </div>
  );
}

function QuestionCard({
  label,
  isActive,
  onClick,
  disabled,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "group w-full text-left rounded-xl border p-3.5 transition-all hover:-translate-y-px",
        isActive
          ? "border-primary/30 bg-primary/[0.08]"
          : "border-card-border bg-muted/20 hover:bg-primary/5 hover:border-primary/25",
        disabled && "opacity-50 cursor-not-allowed",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            "mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
            isActive
              ? "bg-primary/20"
              : "bg-muted-foreground/15 group-hover:bg-primary/15",
          ].join(" ")}
        >
          <MessageSquare
            size={11}
            className={isActive ? "text-primary" : "text-muted-foreground"}
            strokeWidth={2}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={[
              "text-[13px] leading-snug transition-colors mt-1",
              isActive
                ? "text-primary font-medium"
                : "text-foreground/80 group-hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </p>
        </div>
        <ChevronDown
          size={12}
          className={[
            "mt-0.5 flex-shrink-0 transition-transform",
            isActive
              ? "rotate-180 text-primary"
              : "text-muted-foreground/60 group-hover:text-muted-foreground",
          ].join(" ")}
        />
      </div>
    </button>
  );
}

function AnswerArea({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 rounded-full bg-primary" />
        <p className="text-[13px] font-medium text-foreground leading-snug">
          AI Answer
        </p>
      </div>
      {content ? (
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Select a violation or suggestion, then click a question below to get
          AI-powered guidance.
        </p>
      )}
    </div>
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
    stepQuestions,
    engineState,
    isStreaming,
  } = useGovernanceAssistant(wizardData, currentStepIndex);
  const {
    messages,
    initializeModel,
    cancelDownload,
    cancelFromRequiresModel,
    engineState: llmEngineState,
    loadedModel,
    switchModel,
    deleteCachedModel,
    hasModelInCache,
  } = useLocalLLM();

  const [panelView, setPanelView] = useState<PanelView>("main");
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<
    PrebakedQuestion[]
  >([]);
  const autoNavigatedToSettings = useRef(false);

  const handleOpenSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("model-settings");
  }, []);

  const handleBackFromSettings = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("main");
  }, []);

  const handleCancelSetup = useCallback(() => {
    autoNavigatedToSettings.current = false;
    setPanelView("main");
    cancelFromRequiresModel();
  }, [cancelFromRequiresModel]);

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

  // When model becomes ready after auto-navigation to settings (from
  // requires_model), return to main so the user sees governance content
  // instead of being stuck in settings they didn't explicitly open.
  useEffect(() => {
    if (llmEngineState.status === "ready" && autoNavigatedToSettings.current) {
      setPanelView("main");
      autoNavigatedToSettings.current = false;
    }
  }, [llmEngineState.status]);

  // Populate follow-up state from templates when streaming completes
  useEffect(() => {
    if (isStreaming) return;
    setFollowUpQuestions(getFollowUpQuestions());
  }, [isStreaming, getFollowUpQuestions]);

  // Clear follow-ups when context changes to prevent leakage
  useEffect(() => {
    setFollowUpQuestions([]);
  }, [currentStepIndex, activeItem]);

  const { status, progress, errorMessage, autoLoading } = engineState;

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";
  const showRequiresModel = status === "requires_model";

  // localStorage is only available in the browser. During Next.js prerender
  // (Node.js) typeof window === 'undefined', so isOptedIn defaults to false.
  // In that case status is also "unavailable" (from LLM_ENGINE_INITIAL_STATE),
  // so showBootSpinner fires via the status === "unavailable" branch — no mismatch.
  const isOptedIn =
    typeof window !== "undefined" &&
    localStorage.getItem(OPT_OUT_KEY) !== "true" &&
    (localStorage.getItem(HAS_ENABLED_KEY) !== null ||
      localStorage.getItem(AUTO_LOAD_KEY) === "true");

  // Boot Guard + Opted-In Hold: show a spinner for opted-in users while the
  // adapter is still initialising ("unavailable") or waiting for auto-load to
  // start ("opt_in"). This prevents a 1-frame flash of the Enable Local AI card.
  const showBootSpinner =
    status === "unavailable" || (isOptedIn && status === "opt_in");

  // Only show the OptInCard for genuine first-time users once the engine is
  // in a stable opt_in state — never during the transient "unavailable" phase.
  const showOptIn = !isOptedIn && status === "opt_in";

  if (showBootSpinner) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (showUnavailable) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <UnavailableCard status={status} />
        </LifecycleCard>
      </div>
    );
  }

  if (showOptIn) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <OptInCard
            onInitialize={() => initializeModel()}
            isInitializing={false}
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

  if (showProgress) {
    return (
      <div className="h-full">
        <LifecycleCard onRefresh={onRefresh} isLoading={isLoading}>
          <ModelProgressCard
            status={status}
            progress={progress}
            errorMessage={errorMessage}
            onCancel={cancelDownload}
            model={loadedModel}
            modelId={
              status === "downloading"
                ? (llmEngineState.loadedModelId ?? undefined)
                : undefined
            }
          />
        </LifecycleCard>
      </div>
    );
  }

  if (showError) {
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
    setActiveQuestionId(q.id);
    if (activeItem) {
      askQuestion(q);
    } else {
      askStepQuestion(q);
    }
  };

  const handleFollowUpClick = (q: PrebakedQuestion) => {
    setFollowUpQuestions([]);
    if (activeItem) {
      askQuestion(q);
    } else {
      askStepQuestion(q);
    }
  };

  // When the engine explicitly requires a model, force-navigate to the settings
  // view regardless of what panelView was last set to. This ensures cancel from
  // a download always surfaces the settings picker rather than falling through
  // to the governance content with no recovery path.
  if (showRequiresModel && panelView !== "model-settings") {
    setPanelView("model-settings");
    autoNavigatedToSettings.current = true;
  }

  // If status changes away from ready (but NOT to requires_model, which is
  // handled above), auto-navigate back to main so stale settings aren't shown.
  if (
    panelView === "model-settings" &&
    status !== "ready" &&
    !showRequiresModel
  ) {
    setPanelView("main");
    autoNavigatedToSettings.current = false;
  }

  // Show model settings view when: user manually opened it (ready), or the
  // engine demands a model selection (requires_model).
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
        requiresModelWarning={showRequiresModel}
        onCancelSetup={handleCancelSetup}
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
          <div className="space-y-2">
            {displayQuestions.map((q) => (
              <QuestionCard
                key={q.id}
                label={q.label}
                isActive={activeQuestionId === q.id}
                onClick={() => handleQuestionClick(q)}
                disabled={isStreaming}
              />
            ))}
          </div>
        </div>

        {lastAssistantMessage && (
          <div className="mt-4">
            <AnswerArea content={lastAssistantMessage} />
          </div>
        )}

        {followUpQuestions.length > 0 && (
          <div className="mt-4">
            <SectionLabel label="Follow-up Questions" icon={Sparkles} />
            <div className="space-y-2">
              {followUpQuestions.map((q) => (
                <QuestionCard
                  key={q.id}
                  label={q.label}
                  isActive={false}
                  onClick={() => handleFollowUpClick(q)}
                  disabled={isStreaming}
                />
              ))}
            </div>
          </div>
        )}
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
