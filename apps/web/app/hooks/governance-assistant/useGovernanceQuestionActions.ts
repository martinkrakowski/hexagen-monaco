"use client";

import { useCallback } from "react";
import type { LLMMessage } from "@hexagen/local-llm";

import type {
  PrebakedQuestion,
  WizardStepId,
} from "@/lib/governance-question-templates";

import { buildGovernancePrompt } from "./build-governance-prompt";
import {
  GOVERNANCE_SYSTEM_PROMPT,
  MAX_HISTORY_MESSAGES,
  type ActiveItem,
  type ConversationEntry,
} from "./types";

interface UseGovernanceQuestionActionsOptions {
  activeItem: ActiveItem | null;
  currentStepId: WizardStepId;
  wizardContext: string;

  conversationThread: ConversationEntry[];
  expandedQuestionId: string | null;
  setConversationThread: React.Dispatch<
    React.SetStateAction<ConversationEntry[]>
  >;

  governanceHistoryRef: React.MutableRefObject<LLMMessage[]>;
  pendingQuestionLabelRef: React.MutableRefObject<string | null>;
  setRegeneratingEntryId: React.Dispatch<React.SetStateAction<string | null>>;

  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
    history?: LLMMessage[],
  ) => Promise<void>;

  findQuestionById: (
    id: string,
    activeItem: ActiveItem | null,
    stepId: WizardStepId,
  ) => PrebakedQuestion | undefined;
}

export interface UseGovernanceQuestionActionsReturn {
  askQuestion: (question: PrebakedQuestion) => Promise<void>;
  askStepQuestion: (question: PrebakedQuestion) => Promise<void>;
  regenerateAnswer: (entryId: string) => Promise<void>;
}

/**
 * The three question-asking actions. All share the same skeleton:
 *
 *   1. Push a new thread entry (user message) with empty answer
 *   2. Build a prompt via buildGovernancePrompt
 *   3. Build a history window from governanceHistoryRef
 *   4. Call sendGovernanceMessage with (prompt, system, history)
 *
 * regenerateAnswer adds: clear the target entry's answer first,
 * set regeneratingEntryId, and build history from entries BEFORE the
 * target instead of the full ref.
 */
export function useGovernanceQuestionActions(
  options: UseGovernanceQuestionActionsOptions,
): UseGovernanceQuestionActionsReturn {
  const {
    activeItem,
    currentStepId,
    wizardContext,
    conversationThread,
    expandedQuestionId,
    setConversationThread,
    governanceHistoryRef,
    pendingQuestionLabelRef,
    setRegeneratingEntryId,
    sendGovernanceMessage,
    findQuestionById,
  } = options;

  const pushPendingEntry = useCallback(
    (question: PrebakedQuestion) => {
      pendingQuestionLabelRef.current = question.label;
      setConversationThread((prev) => [
        ...prev,
        {
          id: `entry-${Date.now()}`,
          questionLabel: question.label,
          answer: "",
        },
      ]);
    },
    [pendingQuestionLabelRef, setConversationThread],
  );

  const askQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      if (!activeItem) return;
      pushPendingEntry(question);
      const prompt = buildGovernancePrompt(
        question,
        activeItem,
        currentStepId,
        wizardContext,
      );
      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [
      activeItem,
      currentStepId,
      wizardContext,
      governanceHistoryRef,
      sendGovernanceMessage,
      pushPendingEntry,
    ],
  );

  const askStepQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      pushPendingEntry(question);
      const prompt = buildGovernancePrompt(
        question,
        null,
        currentStepId,
        wizardContext,
      );
      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [
      currentStepId,
      wizardContext,
      governanceHistoryRef,
      sendGovernanceMessage,
      pushPendingEntry,
    ],
  );

  const regenerateAnswer = useCallback(
    async (entryId: string) => {
      const targetEntry = conversationThread.find((e) => e.id === entryId);
      if (!targetEntry) return;

      // Clear the answer to signal loading state.
      setConversationThread((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, answer: "" } : e)),
      );
      setRegeneratingEntryId(entryId);

      const question = findQuestionById(
        expandedQuestionId || "",
        activeItem,
        currentStepId,
      );
      if (!question) {
        setRegeneratingEntryId(null);
        return;
      }

      // History from entries BEFORE the target (don't feed it its own
      // previous answer when regenerating).
      const targetIndex = conversationThread.findIndex((e) => e.id === entryId);
      const historyBeforeTarget: LLMMessage[] = [];
      for (let i = 0; i < targetIndex; i++) {
        const entry = conversationThread[i];
        historyBeforeTarget.push(
          { role: "user", content: entry.questionLabel },
          { role: "assistant", content: entry.answer },
        );
      }
      const truncated = historyBeforeTarget.slice(-MAX_HISTORY_MESSAGES);

      const prompt = buildGovernancePrompt(
        question,
        activeItem,
        currentStepId,
        wizardContext,
      );
      pendingQuestionLabelRef.current = question.label;
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, truncated);
    },
    [
      conversationThread,
      expandedQuestionId,
      activeItem,
      currentStepId,
      wizardContext,
      setConversationThread,
      setRegeneratingEntryId,
      pendingQuestionLabelRef,
      sendGovernanceMessage,
      findQuestionById,
    ],
  );

  return { askQuestion, askStepQuestion, regenerateAnswer };
}
