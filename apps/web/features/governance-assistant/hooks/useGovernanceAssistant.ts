"use client";

import { useCallback, useEffect, useState } from "react";
import type { WizardData } from "@hexagen/shared";

import { useLocalLLM } from "@/hooks/useLocalLlm";
import {
  findQuestionById,
  STEP_FOLLOW_UPS,
  SUGGESTION_FOLLOW_UPS,
  SUGGESTION_QUESTIONS,
  VIOLATION_FOLLOW_UPS,
  VIOLATION_QUESTIONS,
  type PrebakedQuestion,
} from "@/lib/governance-question-templates";
import { serializeWizardContext } from "@/lib/wizard-assistant-context";

import { useGovernanceKeys } from "./governance-assistant/derive-governance-keys";
import { useGovernanceThread } from "./governance-assistant/useGovernanceThread";
import { useGovernanceQuestionActions } from "./governance-assistant/useGovernanceQuestionActions";
import { useAutoAskOnExpand } from "./governance-assistant/useAutoAskOnExpand";
import type {
  ActiveItem,
  ConversationEntry,
} from "./governance-assistant/types";

export type { ActiveItem, ConversationEntry };

/**
 * Governance assistant orchestrator. Composes four focused
 * sub-hooks:
 *
 *   - useGovernanceKeys: derives currentStepId, stepQuestions,
 *     contextKey from (step, activeItem, expandedQuestion)
 *   - useGovernanceThread: owns conversationThread + load/persist/
 *     finalize effects + governanceHistoryRef
 *   - useGovernanceQuestionActions: askQuestion / askStepQuestion /
 *     regenerateAnswer via shared buildGovernancePrompt helper
 *   - useAutoAskOnExpand: auto-fires the root question on first
 *     accordion expand
 *
 * The LLM transport (sendGovernanceMessage, messages, isStreaming,
 * engineState) is read from useLocalLLM.
 */
export function useGovernanceAssistant(
  wizardData: WizardData,
  currentStepIndex: number,
) {
  const { messages, sendGovernanceMessage, engineState, isStreaming } =
    useLocalLLM();

  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(
    null,
  );

  const wizardContext = serializeWizardContext(wizardData);

  const { currentStepId, stepQuestions, contextKey } = useGovernanceKeys({
    currentStepIndex,
    activeItem,
    expandedQuestionId,
  });

  const thread = useGovernanceThread({
    contextKey,
    messages,
    isStreaming,
  });

  const { askQuestion, askStepQuestion, regenerateAnswer } =
    useGovernanceQuestionActions({
      activeItem,
      currentStepId,
      wizardContext,
      conversationThread: thread.conversationThread,
      expandedQuestionId,
      setConversationThread: thread.setConversationThread,
      governanceHistoryRef: thread.governanceHistoryRef,
      pendingQuestionLabelRef: thread.pendingQuestionLabelRef,
      setRegeneratingEntryId: thread.setRegeneratingEntryId,
      sendGovernanceMessage,
      findQuestionById,
    });

  useAutoAskOnExpand({
    threadLoaded: thread.threadLoaded,
    threadLoadingRef: thread.threadLoadingRef,
    loadCompleteToken: thread.loadCompleteToken,
    expandedQuestionId,
    conversationThread: thread.conversationThread,
    isStreaming,
    activeItem,
    currentStepId,
    askQuestion,
    askStepQuestion,
  });

  const selectItem = useCallback((item: ActiveItem) => {
    setActiveItem(item);
    setExpandedQuestionId(null);
  }, []);

  const expandAccordion = useCallback((questionId: string) => {
    setExpandedQuestionId((prev) => (prev === questionId ? null : questionId));
  }, []);

  const getQuestions = useCallback((): PrebakedQuestion[] => {
    if (!activeItem) return [];
    return activeItem.type === "violation"
      ? VIOLATION_QUESTIONS
      : SUGGESTION_QUESTIONS;
  }, [activeItem]);

  const getFollowUpQuestions = useCallback((): PrebakedQuestion[] => {
    const asked = new Set(
      thread.conversationThread.map((e) => e.questionLabel),
    );
    const candidates: PrebakedQuestion[] = activeItem
      ? activeItem.type === "violation"
        ? VIOLATION_FOLLOW_UPS
        : SUGGESTION_FOLLOW_UPS
      : (STEP_FOLLOW_UPS[currentStepId] ?? []);
    return candidates.filter((q) => !asked.has(q.label));
  }, [activeItem, currentStepId, thread.conversationThread]);

  // Reset accordion and activeItem when the wizard step changes.
  useEffect(() => {
    setExpandedQuestionId(null);
    setActiveItem(null);
  }, [currentStepIndex]);

  return {
    activeItem,
    selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    getFollowUpQuestions,
    conversationThread: thread.conversationThread,
    stepQuestions,
    engineState,
    isStreaming,
    expandedQuestionId,
    expandAccordion,
    regeneratingEntryId: thread.regeneratingEntryId,
    regenerateAnswer,
    threadLoaded: thread.threadLoaded,
  };
}
