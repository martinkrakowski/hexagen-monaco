import { useMemo } from "react";

import {
  STEP_QUESTIONS,
  type PrebakedQuestion,
  type WizardStepId,
} from "@/lib/governance-question-templates";
import { wizardSteps } from "../../../features/project-wizard/config";

import type { ActiveItem } from "./types";

interface UseGovernanceKeysOptions {
  currentStepIndex: number;
  activeItem: ActiveItem | null;
  expandedQuestionId: string | null;
}

export interface GovernanceKeys {
  /** Canonical step id for the currently-active wizard step. */
  currentStepId: WizardStepId;
  /** Prebaked question catalogue for the current step (step-level questions only). */
  stepQuestions: PrebakedQuestion[];
  /**
   * IDB storage key for the current {activeItem, step, expandedQuestion}
   * triple. Returns null when no accordion is expanded (don't persist
   * anything in that state).
   */
  contextKey: string | null;
}

/**
 * Pure-ish derivation hook. Turns (currentStepIndex, activeItem,
 * expandedQuestionId) into the three keys the governance thread
 * system needs for question lookup and storage scoping.
 */
export function useGovernanceKeys({
  currentStepIndex,
  activeItem,
  expandedQuestionId,
}: UseGovernanceKeysOptions): GovernanceKeys {
  const currentStepId = useMemo<WizardStepId>(() => {
    const step = wizardSteps[currentStepIndex];
    return (step?.id as WizardStepId) ?? "workspace_governance";
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
