"use client";

import { useState, useMemo } from "react";
import type { WizardData } from "@hexagen/shared";
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
} from "lucide-react";
import { OptInCard } from "./OptInCard";
import { WakingUpCard } from "./WakingUpCard";
import { ModelProgressCard } from "./ModelProgressCard";
import { UnavailableCard } from "./UnavailableCard";

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
    <div className="px-5 py-4 flex-shrink-0">
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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
        <Plus size={10} className="text-primary" strokeWidth={2.5} />
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
              "text-[13px] leading-snug transition-colors",
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

function PanelFooter() {
  return (
    <div className="flex-shrink-0 px-5 py-3 border-t border-card-border bg-card">
      <div className="flex items-center gap-2">
        <Info size={12} className="text-muted-foreground/60" />
        <p className="text-[11px] text-muted-foreground/60">
          Click a question to get an AI-powered answer
        </p>
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
    stepQuestions,
    engineState,
    isStreaming,
  } = useGovernanceAssistant(wizardData, currentStepIndex);
  const { messages, initializeModel, cancelDownload, clearError } =
    useLocalLLM();

  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

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

  const { status, progress, errorMessage, autoLoading } = engineState;

  const showUnavailable =
    status === "no_webgpu" || status === "unsupported_browser";
  const showOptIn = status === "opt_in" || status === "unavailable";
  const showWakingUp = status === "loading_vram" && autoLoading;
  const showProgress =
    status === "downloading" || (status === "loading_vram" && !autoLoading);
  const showError = status === "error";

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
          <OptInCard onInitialize={initializeModel} isInitializing={false} />
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
            onRetry={clearError}
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

  return (
    <div className="h-full flex flex-col bg-card">
      <PanelHeader onRefresh={onRefresh} isLoading={isLoading} />
      <GradientDivider />
      <StepPills currentStepIndex={currentStepIndex} />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
        <StatusSummaryCard violations={violations} suggestions={suggestions} />

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
      </div>

      <PanelFooter />
    </div>
  );
}
