"use client";

import { useState } from "react";
import type { WizardData } from "@hexagen/shared";
import { useGovernanceAssistant } from "@/hooks/use-governance-assistant";
import { useLocalLLM } from "@/hooks/use-local-llm";
import {
  type Violation,
  type AISuggestion,
} from "@/lib/governance-question-templates";
import {
  Check,
  ChevronDown,
  Info,
  MessageSquare,
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
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
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
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-3">
        Current Step
      </p>
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
                  ? "bg-primary/15 text-primary shadow-none border border-primary/20"
                  : isCompleted
                    ? "text-success"
                    : "text-muted-foreground hover:text-foreground",
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

function statusCardClasses(kind: StatusKind): string {
  switch (kind) {
    case "warning":
      return "rounded-xl border border-warning/15 bg-warning/5 p-4";
    case "violation":
      return "rounded-xl border border-destructive/15 bg-destructive/5 p-4";
    default:
      return "rounded-xl border border-border bg-muted/30 p-4";
  }
}

function statusDotClasses(kind: StatusKind): string {
  switch (kind) {
    case "warning":
      return "w-2 h-2 rounded-full bg-warning animate-pulse";
    case "violation":
      return "w-2 h-2 rounded-full bg-destructive animate-pulse";
    default:
      return "w-2 h-2 rounded-full bg-success animate-pulse";
  }
}

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

  return (
    <div className={statusCardClasses(kind)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <div className={statusDotClasses(kind)} />
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

function SectionLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
        {icon}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function QuestionCard({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left rounded-xl border transition-all",
        "hover:-translate-y-px hover:bg-primary/5 hover:border-primary/25",
        isActive
          ? "border-primary/30 bg-primary/10"
          : "border-border bg-muted/30",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div
          className={[
            "mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
            isActive ? "bg-primary/20" : "bg-muted",
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
                : "text-muted-foreground group-hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </p>
        </div>
        <ChevronDown
          size={12}
          className={[
            "mt-0.5 flex-shrink-0 transition-transform",
            isActive ? "rotate-180 text-primary" : "text-muted-foreground",
          ].join(" ")}
        />
      </div>
    </button>
  );
}

function AnswerArea({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 rounded-full bg-primary" />
        <p className="text-[13px] font-medium text-foreground leading-snug">
          AI Answer
        </p>
      </div>
      {content ? (
        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
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
    <div className="flex-shrink-0 px-5 py-3 border-t border-border bg-card">
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
  title,
  onRefresh,
  isLoading,
}: {
  title: string;
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShieldCheck size={14} className="text-primary" strokeWidth={2} />
            </div>
            <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
              {title}
            </h1>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Refresh checks"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground font-normal pl-[38px]">
          Governance Assistant
        </p>
      </div>
      <GradientDivider />
    </div>
  );
}

function LifecycleCard({
  title,
  onRefresh,
  isLoading,
  children,
}: {
  title: string;
  onRefresh: () => void;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <LifecycleHeader
        title={title}
        onRefresh={onRefresh}
        isLoading={isLoading}
      />
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
    selectItem: _selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    stepQuestions,
    engineState,
    isStreaming: _isStreaming,
  } = useGovernanceAssistant(wizardData, currentStepIndex);
  const { messages, initializeModel, cancelDownload, clearError } =
    useLocalLLM();

  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  const questions = getQuestions();

  const lastAssistantMessage = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].content;
      }
    }
    return "";
  })();

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
        <LifecycleCard
          title="Governance"
          onRefresh={onRefresh}
          isLoading={isLoading}
        >
          <UnavailableCard status={status} />
        </LifecycleCard>
      </div>
    );
  }

  if (showOptIn) {
    return (
      <div className="h-full">
        <LifecycleCard
          title="Governance"
          onRefresh={onRefresh}
          isLoading={isLoading}
        >
          <OptInCard onInitialize={initializeModel} isInitializing={false} />
        </LifecycleCard>
      </div>
    );
  }

  if (showWakingUp) {
    return (
      <div className="h-full">
        <LifecycleCard
          title="Governance"
          onRefresh={onRefresh}
          isLoading={isLoading}
        >
          <WakingUpCard onCancel={cancelDownload} />
        </LifecycleCard>
      </div>
    );
  }

  if (showProgress) {
    return (
      <div className="h-full">
        <LifecycleCard
          title="Governance"
          onRefresh={onRefresh}
          isLoading={isLoading}
        >
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
        <LifecycleCard
          title="Governance"
          onRefresh={onRefresh}
          isLoading={isLoading}
        >
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

  const handleQuestionClick = (q: {
    id: string;
    label: string;
    type: string;
  }) => {
    setActiveQuestionId(q.id);
    if (activeItem) {
      askQuestion(q as Parameters<typeof askQuestion>[0]);
    } else {
      askStepQuestion(q as Parameters<typeof askStepQuestion>[0]);
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      <PanelHeader onRefresh={onRefresh} isLoading={isLoading} />
      <GradientDivider />
      <StepPills currentStepIndex={currentStepIndex} />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
        <StatusSummaryCard violations={violations} suggestions={suggestions} />

        {(violations.length > 0 || suggestions.length > 0) && (
          <div className="mt-5">
            <SectionLabel
              icon={
                <svg
                  width={10}
                  height={10}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M12 3v18" />
                  <path d="M5 12h14" />
                </svg>
              }
              label={
                activeItem
                  ? "Violation / Suggestion Questions"
                  : "Step Questions"
              }
            />
            <div className="space-y-2">
              {(activeItem ? questions : stepQuestions).map((q) => (
                <QuestionCard
                  key={q.id}
                  label={q.label}
                  isActive={activeQuestionId === q.id}
                  onClick={() => handleQuestionClick(q)}
                />
              ))}
            </div>
          </div>
        )}

        {lastAssistantMessage && (
          <div className="mt-4">
            <AnswerArea content={lastAssistantMessage} />
          </div>
        )}

        {violations.length === 0 && suggestions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No violations or suggestions.</p>
            <p className="text-sm mt-1">Click Refresh to check for issues.</p>
          </div>
        )}
      </div>

      <PanelFooter />
    </div>
  );
}
