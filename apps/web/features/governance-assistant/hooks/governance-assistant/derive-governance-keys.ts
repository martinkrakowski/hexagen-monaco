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
  /**
   * Bare keys to try, in priority order, when the scoped thread is empty —
   * i.e. threads written before scoping. The unsaved session's thread comes
   * first, then the bare pre-change key. Empty for the `unsaved` scope itself,
   * which never adopts (see useGovernanceThread).
   */
  adoptionSources: string[];
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

  const adoptionSources = useMemo<string[]>(() => {
    if (projectId === null || bareContextKey === null) return [];
    return [scopeGovernanceKey(null, bareContextKey), bareContextKey];
  }, [projectId, bareContextKey]);

  return { currentStepId, stepQuestions, contextKey, adoptionSources };
}
