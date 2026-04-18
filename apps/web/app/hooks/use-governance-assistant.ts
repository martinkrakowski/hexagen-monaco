"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { WizardData } from "@hexagen/shared";
import type { LLMMessage, GovernanceEntry } from "@hexagen/local-llm";
import { useLocalLLM } from "./use-local-llm";
import { getChatPersistence } from "@/lib/wire";
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

// Re-export for backward compatibility — ConversationEntry is now GovernanceEntry from domain
export type ConversationEntry = GovernanceEntry;

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

  /**
   * Derive storage key for the current governance context.
   * Keys are scoped to step or violation/suggestion to avoid cross-context pollution.
   */
  const contextKey = useMemo<string>(() => {
    if (activeItem) {
      return `${activeItem.type}:${activeItem.item.id}`;
    }
    return `step:${currentStepId}`;
  }, [activeItem, currentStepId]);

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

  // Load/refresh conversation thread and history when context changes.
  // Also rebuilds governanceHistoryRef from loaded thread entries.
  useEffect(() => {
    const port = getChatPersistence();
    port
      .loadGovernanceThread(contextKey)
      .then((result) => {
        if (result.success) {
          setConversationThread(result.value);
          // Rebuild governanceHistoryRef from loaded thread entries
          const rebuilt: LLMMessage[] = [];
          for (const entry of result.value) {
            rebuilt.push(
              { role: "user", content: entry.questionLabel },
              { role: "assistant", content: entry.answer },
            );
          }
          governanceHistoryRef.current = rebuilt;
        } else {
          // Load failed — start fresh
          setConversationThread([]);
          governanceHistoryRef.current = [];
        }
        pendingQuestionLabelRef.current = null;
      })
      .catch(() => {
        // Non-fatal — start fresh if load fails
        setConversationThread([]);
        governanceHistoryRef.current = [];
        pendingQuestionLabelRef.current = null;
      });
  }, [contextKey]);

  // Persist governance thread after finalization.
  // Saves when: streaming completes, thread has been loaded, and there are entries.
  useEffect(() => {
    if (isStreaming || conversationThread.length === 0) return;

    const port = getChatPersistence();
    port.saveGovernanceThread(contextKey, conversationThread).catch(() => {
      // Non-fatal — allow app to proceed even if save fails
      // eslint-disable-next-line no-console
      console.warn(
        `Failed to persist governance thread for context: ${contextKey}`,
      );
    });
  }, [contextKey, isStreaming, conversationThread]);

  const getQuestions = useCallback((): PrebakedQuestion[] => {
    if (!activeItem) return [];
    return activeItem.type === "violation"
      ? VIOLATION_QUESTIONS
      : SUGGESTION_QUESTIONS;
  }, [activeItem]);

  const getFollowUpQuestions = useCallback((): PrebakedQuestion[] => {
    const askedLabels = new Set(conversationThread.map((e) => e.questionLabel));
    let candidates: PrebakedQuestion[];
    if (activeItem) {
      candidates =
        activeItem.type === "violation"
          ? VIOLATION_FOLLOW_UPS
          : SUGGESTION_FOLLOW_UPS;
    } else {
      candidates = STEP_FOLLOW_UPS[currentStepId] ?? [];
    }
    return candidates.filter((q) => !askedLabels.has(q.label));
  }, [activeItem, currentStepId, conversationThread]);

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
