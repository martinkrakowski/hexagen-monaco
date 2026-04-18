"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { WizardData } from "@hexagen/shared";
import type { LLMMessage } from "@hexagen/local-llm";
import { useLocalLLM } from "./use-local-llm";
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
  type WizardStepId,
  VIOLATION_QUESTIONS,
  SUGGESTION_QUESTIONS,
  STEP_QUESTIONS,
  STEP_FOLLOW_UPS,
  VIOLATION_FOLLOW_UPS,
  SUGGESTION_FOLLOW_UPS,
  buildViolationPrompt,
  buildSuggestionPrompt,
  buildStepPrompt,
} from "@/lib/governance-question-templates";
import { serializeWizardContext } from "@/lib/wizard-assistant-context";
import { wizardSteps } from "@/components/project-wizard/config";

const GOVERNANCE_SYSTEM_PROMPT =
  "You are a Hexagonal Architecture expert assistant in HexaGen Monaco. Always respond in English. Answer questions concisely and helpfully. You have access to the user's project wizard context which describes their bounded contexts, governance settings, and peer mappings.";

/** Cap conversation history to last N messages (user+assistant pairs) to stay within small-model context budgets. */
const MAX_HISTORY_MESSAGES = 4;

export interface ConversationEntry {
  id: string;
  questionLabel: string;
  answer: string;
}

export type ActiveItem =
  | { type: "violation"; item: Violation }
  | { type: "suggestion"; item: AISuggestion };

export function useGovernanceAssistant(
  wizardData: WizardData,
  currentStepIndex: number,
) {
  const { messages, sendGovernanceMessage, engineState, isStreaming } =
    useLocalLLM();
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [conversationThread, setConversationThread] = useState<
    ConversationEntry[]
  >([]);

  /**
   * Condensed LLM history for conversational context. Stores question labels
   * (not full prompts) as user messages to keep token count low. Capped to
   * MAX_HISTORY_MESSAGES to stay within small-model context windows.
   */
  const governanceHistoryRef = useRef<LLMMessage[]>([]);

  /** Tracks the question label for the currently streaming entry. */
  const pendingQuestionLabelRef = useRef<string | null>(null);

  /** Tracks whether we were streaming in the previous render (for edge detection). */
  const wasStreamingRef = useRef(false);

  const wizardContext = serializeWizardContext(wizardData);

  const currentStepId = useMemo<WizardStepId>(() => {
    const step = wizardSteps[currentStepIndex];
    return (step?.id as WizardStepId) ?? "workspace_governance";
  }, [currentStepIndex]);

  const stepQuestions = useMemo<PrebakedQuestion[]>(() => {
    return STEP_QUESTIONS[currentStepId] ?? [];
  }, [currentStepId]);

  const selectItem = useCallback((item: ActiveItem) => {
    setActiveItem(item);
  }, []);

  const askQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      if (!activeItem) return;

      // Push a new thread entry for this question
      const entryId = `entry-${Date.now()}`;
      pendingQuestionLabelRef.current = question.label;
      setConversationThread((prev) => [
        ...prev,
        { id: entryId, questionLabel: question.label, answer: "" },
      ]);

      let prompt: string;
      if (activeItem.type === "violation") {
        prompt = buildViolationPrompt(question, activeItem.item, wizardContext);
      } else {
        prompt = buildSuggestionPrompt(
          question,
          activeItem.item,
          wizardContext,
        );
      }

      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [activeItem, wizardContext, sendGovernanceMessage],
  );

  const askStepQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      // Push a new thread entry for this question
      const entryId = `entry-${Date.now()}`;
      pendingQuestionLabelRef.current = question.label;
      setConversationThread((prev) => [
        ...prev,
        { id: entryId, questionLabel: question.label, answer: "" },
      ]);

      const prompt = buildStepPrompt(question, currentStepId, wizardContext);
      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [currentStepId, wizardContext, sendGovernanceMessage],
  );

  // Finalize the last thread entry when streaming completes.
  // Uses edge detection (wasStreaming -> !isStreaming) to run exactly once.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      // Extract last assistant message content
      let lastAnswer = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAnswer = messages[i].content;
          break;
        }
      }

      if (lastAnswer) {
        // Finalize the thread entry
        setConversationThread((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.answer) return prev; // already finalized
          return [...prev.slice(0, -1), { ...last, answer: lastAnswer }];
        });

        // Append to governance history for future context
        const questionLabel = pendingQuestionLabelRef.current;
        if (questionLabel) {
          governanceHistoryRef.current.push(
            { role: "user", content: questionLabel },
            { role: "assistant", content: lastAnswer },
          );
          pendingQuestionLabelRef.current = null;
        }
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages]);

  // Clear conversation thread and history when context changes
  useEffect(() => {
    setConversationThread([]);
    governanceHistoryRef.current = [];
    pendingQuestionLabelRef.current = null;
  }, [currentStepIndex, activeItem]);

  const getQuestions = useCallback((): PrebakedQuestion[] => {
    if (!activeItem) return [];
    return activeItem.type === "violation"
      ? VIOLATION_QUESTIONS
      : SUGGESTION_QUESTIONS;
  }, [activeItem]);

  const getFollowUpQuestions = useCallback((): PrebakedQuestion[] => {
    if (activeItem) {
      return activeItem.type === "violation"
        ? VIOLATION_FOLLOW_UPS
        : SUGGESTION_FOLLOW_UPS;
    }
    return STEP_FOLLOW_UPS[currentStepId] ?? [];
  }, [activeItem, currentStepId]);

  return {
    activeItem,
    selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    getFollowUpQuestions,
    conversationThread,
    stepQuestions,
    engineState,
    isStreaming,
  };
}
