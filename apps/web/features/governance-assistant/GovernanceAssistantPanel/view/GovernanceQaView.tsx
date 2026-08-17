"use client";

import type { DomainModelId } from "@hexagen/local-llm";
import { StepPills, PanelFooter } from "../../governance";
import { StatusSection } from "./StatusSection";
import { ViolationsSection } from "./ViolationsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { QuestionsSection } from "./QuestionsSection";
import type {
  StatusSectionProps,
  ViolationsSectionProps,
  SuggestionsSectionProps,
  QuestionsSectionProps,
} from "../types";

export interface GovernanceQaViewProps
  extends
    StatusSectionProps,
    ViolationsSectionProps,
    SuggestionsSectionProps,
    QuestionsSectionProps {
  currentStepIndex: number;
  /** Local model currently loaded, if any — the footer's first choice of label. */
  footerModelId: DomainModelId | null;
  /** Server assistant model name, once the capability probe has confirmed one. */
  footerModelLabel?: string;
  footerIsLoading: boolean;
  onOpenSettings: () => void;
}

/**
 * The governance Q&A surface (REA-001).
 *
 * Props only: no engine subscription, no cloud transport, no capability probe,
 * no DI container. Everything it shows arrives as data and everything it wants
 * done leaves as a callback, which is what makes it renderable — and testable —
 * without a provider tree. `GovernanceAssistantPanel` is the boundary that owns
 * all of that; this directory is lint-fenced against reaching back for it.
 */
export function GovernanceQaView({
  currentStepIndex,
  violations,
  suggestions,
  activeItem,
  onSelectViolation,
  onSelectSuggestion,
  footerModelId,
  footerModelLabel,
  footerIsLoading,
  onOpenSettings,
  ...questionProps
}: GovernanceQaViewProps) {
  return (
    <div className="h-full flex flex-col bg-card">
      <StepPills currentStepIndex={currentStepIndex} />
      <div className="h-px mx-5 mb-3 bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5">
        <StatusSection violations={violations} suggestions={suggestions} />
        <ViolationsSection
          violations={violations}
          activeItem={activeItem}
          onSelectViolation={onSelectViolation}
        />
        <SuggestionsSection
          suggestions={suggestions}
          activeItem={activeItem}
          onSelectSuggestion={onSelectSuggestion}
        />
        <QuestionsSection {...questionProps} activeItem={activeItem} />
      </div>

      <PanelFooter
        modelId={footerModelId}
        modelLabel={footerModelLabel}
        onOpenSettings={onOpenSettings}
        isLoading={footerIsLoading}
      />
    </div>
  );
}
