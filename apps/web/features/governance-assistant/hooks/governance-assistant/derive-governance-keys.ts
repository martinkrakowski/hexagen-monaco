import { useMemo } from "react";

import {
  STEP_QUESTIONS,
  WIZARD_STEP_ORDER,
  type PrebakedQuestion,
  type WizardStepId,
} from "@hexagen/prompt-compiler";

import type { ActiveItem } from "./types";

interface UseGovernanceKeysOptions {
  currentStepIndex: number;
  activeItem: ActiveItem | null;
  expandedQuestionId: string | null;
}

export interface GovernanceKeys {
  currentStepId: WizardStepId;
  stepQuestions: PrebakedQuestion[];
  contextKey: string | null;
}

export function useGovernanceKeys({
  currentStepIndex,
  activeItem,
  expandedQuestionId,
}: UseGovernanceKeysOptions): GovernanceKeys {
  const currentStepId = useMemo<WizardStepId>(() => {
    return WIZARD_STEP_ORDER[currentStepIndex] ?? "workspace_governance";
  }, [currentStepIndex]);

  const stepQuestions = useMemo<PrebakedQuestion[]>(() => {
    return STEP_QUESTIONS[currentStepId] ?? [];
  }, [currentStepId]);

  const contextKey = useMemo<string | null>(() => {
    if (!expandedQuestionId) return null;
    if (activeItem) {
      return `${activeItem.type}:${activeItem.item.id}:q:${expandedQuestionId}`;
    }
    return `step:${currentStepId}:q:${expandedQuestionId}`;
  }, [activeItem, currentStepId, expandedQuestionId]);

  return { currentStepId, stepQuestions, contextKey };
}
