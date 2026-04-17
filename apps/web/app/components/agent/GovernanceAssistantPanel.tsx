"use client";

import { useMemo } from "react";
import type { WizardData } from "@hexagen/shared";
import { CardContent, CardHeader } from "@/components/ui/Card";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useGovernanceAssistant } from "@/hooks/use-governance-assistant";
import { useLocalLLM } from "@/hooks/use-local-llm";
import {
  type Violation,
  type AISuggestion,
} from "@/lib/governance-question-templates";
import {
  AlertTriangle,
  Lightbulb,
  MessageSquare,
  RefreshCw,
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
    HIGH: "bg-red-500",
    MEDIUM: "bg-amber-500",
    LOW: "bg-blue-500",
  }[violation.severity];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityColor}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm line-clamp-2">{violation.message}</p>
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
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm line-clamp-2">{suggestion.message}</p>
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

function AnswerArea({ content }: { content: string }) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg min-h-[100px]">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">AI Answer</span>
      </div>
      {content ? (
        <p className="text-sm whitespace-pre-wrap">{content}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a violation or suggestion, then click a question below to get
          AI-powered guidance.
        </p>
      )}
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

  const questions = useMemo(() => getQuestions(), [getQuestions]);

  const lastAssistantMessage = useMemo(() => {
    const msgs = messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        return msgs[i].content;
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
        <CardHeader className="pb-2 border-b">
          <h3 className="font-semibold">Governance Assistant</h3>
        </CardHeader>
        <UnavailableCard status={status} />
      </div>
    );
  }

  if (showOptIn) {
    return (
      <div className="h-full">
        <CardHeader className="pb-2 border-b">
          <h3 className="font-semibold">Governance Assistant</h3>
        </CardHeader>
        <OptInCard onInitialize={initializeModel} isInitializing={false} />
      </div>
    );
  }

  if (showWakingUp) {
    return (
      <div className="h-full">
        <CardHeader className="pb-2 border-b">
          <h3 className="font-semibold">Governance Assistant</h3>
        </CardHeader>
        <WakingUpCard onCancel={cancelDownload} />
      </div>
    );
  }

  if (showProgress) {
    return (
      <div className="h-full">
        <CardHeader className="pb-2 border-b">
          <h3 className="font-semibold">Governance Assistant</h3>
        </CardHeader>
        <ModelProgressCard
          status={status}
          progress={progress}
          errorMessage={errorMessage}
          onCancel={cancelDownload}
        />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="h-full">
        <CardHeader className="pb-2 border-b">
          <h3 className="font-semibold">Governance Assistant</h3>
        </CardHeader>
        <ModelProgressCard
          status={status}
          progress={progress}
          errorMessage={errorMessage}
          onRetry={clearError}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <CardHeader className="pb-2 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Governance Assistant</h3>
          <PrimaryButton
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              "Refresh"
            )}
          </PrimaryButton>
        </div>
      </CardHeader>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-3">
            {violations.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-medium">
                    Violations ({violations.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {violations.map((v) => (
                    <ViolationItem
                      key={v.id}
                      violation={v}
                      isSelected={
                        activeItem?.type === "violation" &&
                        activeItem.item.id === v.id
                      }
                      onSelect={() =>
                        selectItem({ type: "violation", item: v })
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {suggestions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">
                    Suggestions ({suggestions.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <SuggestionItem
                      key={s.id}
                      suggestion={s}
                      isSelected={
                        activeItem?.type === "suggestion" &&
                        activeItem.item.id === s.id
                      }
                      onSelect={() =>
                        selectItem({ type: "suggestion", item: s })
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {violations.length === 0 && suggestions.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No violations or suggestions.</p>
                <p className="text-sm">Click Refresh to check for issues.</p>
              </div>
            )}
          </div>
        </div>

        <CardContent className="border-t pt-3 space-y-3">
          <AnswerArea content={lastAssistantMessage} />

          {activeItem && questions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {questions.map((q) => (
                <PrimaryButton
                  key={q.id}
                  variant="outline"
                  size="sm"
                  onClick={() => askQuestion(q)}
                  disabled={isStreaming}
                >
                  {q.label}
                </PrimaryButton>
              ))}
            </div>
          )}

          {!activeItem && stepQuestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {stepQuestions.map((q) => (
                <PrimaryButton
                  key={q.id}
                  variant="outline"
                  size="sm"
                  onClick={() => askStepQuestion(q)}
                  disabled={isStreaming}
                >
                  {q.label}
                </PrimaryButton>
              ))}
            </div>
          )}
        </CardContent>
      </div>
    </div>
  );
}
