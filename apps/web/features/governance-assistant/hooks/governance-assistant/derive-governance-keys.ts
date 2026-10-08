import { useMemo } from "react";

import {
  STEP_QUESTIONS,
  WIZARD_STEP_ORDER,
  type PrebakedQuestion,
  type WizardStepId,
} from "@hexagen/prompt-compiler";

import { scopeGovernanceKey } from "./scope-governance-key";
import type { ActiveItem } from "./types";

interface UseGovernanceKeysOptions {
  currentStepIndex: number;
  activeItem: ActiveItem | null;
  expandedQuestionId: string | null;
  /** Active project id (null for an unsaved project that has no id yet). */
  projectId: string | null;
}

export interface GovernanceKeys {
  currentStepId: WizardStepId;
  stepQuestions: PrebakedQuestion[];
  /** Scoped storage key (`projectId`-prefixed); what the store + IDB use. */
  contextKey: string | null;
  /** Bare key, only used to adopt a thread written before this change. */
  legacyContextKey: string | null;
}

export function useGovernanceKeys({
  currentStepIndex,
  activeItem,
  expandedQuestionId,
  projectId,
}: UseGovernanceKeysOptions): GovernanceKeys {
  const currentStepId = useMemo<WizardStepId>(() => {
    return WIZARD_STEP_ORDER[currentStepIndex] ?? "workspace_governance";
  }, [currentStepIndex]);

  const stepQuestions = useMemo<PrebakedQuestion[]>(() => {
    return STEP_QUESTIONS[currentStepId] ?? [];
  }, [currentStepId]);

  const bareContextKey = useMemo<string | null>(() => {
    if (!expandedQuestionId) return null;
    if (activeItem) {
      return `${activeItem.type}:${activeItem.item.id}:q:${expandedQuestionId}`;
    }
    return `step:${currentStepId}:q:${expandedQuestionId}`;
  }, [activeItem, currentStepId, expandedQuestionId]);

  const contextKey = useMemo<string | null>(() => {
    if (bareContextKey === null) return null;
    return scopeGovernanceKey(projectId, bareContextKey);
  }, [bareContextKey, projectId]);

  const legacyContextKey = useMemo<string | null>(() => {
    if (projectId === null || bareContextKey === null) return null;
    return bareContextKey;
  }, [projectId, bareContextKey]);

  return { currentStepId, stepQuestions, contextKey, legacyContextKey };
}
