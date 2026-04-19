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
  findQuestionById,
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
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(
    null,
  );
  const [regeneratingEntryId, setRegeneratingEntryId] = useState<string | null>(
    null,
  );
  const [threadLoaded, setThreadLoaded] = useState(false);

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

  /**
   * Synchronous guard for the load effect. Prevents the auto-ask effect from
   * firing in the same effect cycle where the load effect has started an async
   * IDB read. Unlike threadLoaded state (which is batched by React and only
   * visible in the next render), this ref is set synchronously and immediately
   * visible to later effects in the same cycle.
   */
  const threadLoadingRef = useRef(false);

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
   * Keys are scoped to question level: step/violation/suggestion + question ID.
   * If no accordion is expanded, contextKey is null (no persistence).
   */
  const contextKey = useMemo<string | null>(() => {
    if (!expandedQuestionId) {
      return null;
    }
    if (activeItem) {
      return `${activeItem.type}:${activeItem.item.id}:q:${expandedQuestionId}`;
    }
    return `step:${currentStepId}:q:${expandedQuestionId}`;
  }, [activeItem, currentStepId, expandedQuestionId]);

  const selectItem = useCallback((item: ActiveItem) => {
    setActiveItem(item);
    setExpandedQuestionId(null);
  }, []);

  const expandAccordion = useCallback((questionId: string) => {
    setExpandedQuestionId((prev) => (prev === questionId ? null : questionId));
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

  // Finalize the thread entry when streaming completes.
  // Uses edge detection (wasStreaming -> !isStreaming) to run exactly once.
  // Supports two modes: normal (last entry) and regeneration (specific entry by ID).
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
        // Determine which entry to finalize: regenerating target or last entry
        const targetEntryId = regeneratingEntryId;

        setConversationThread((prev) => {
          if (prev.length === 0) return prev;

          if (targetEntryId) {
            // Regeneration mode: find and update the specific entry
            const targetIndex = prev.findIndex((e) => e.id === targetEntryId);
            if (targetIndex === -1) return prev; // entry not found, skip
            const targetEntry = prev[targetIndex];
            if (targetEntry.answer && targetEntry.answer !== "") {
              return prev; // already finalized, skip
            }
            // Overwrite the specific entry's answer
            const updated = [...prev];
            updated[targetIndex] = { ...targetEntry, answer: lastAnswer };
            return updated;
          } else {
            // Normal mode: finalize the last entry
            const last = prev[prev.length - 1];
            if (last.answer) return prev; // already finalized
            return [...prev.slice(0, -1), { ...last, answer: lastAnswer }];
          }
        });

        // Rebuild governanceHistoryRef from the full thread after finalization
        setConversationThread((prev) => {
          const rebuilt: LLMMessage[] = [];
          for (const entry of prev) {
            rebuilt.push(
              { role: "user", content: entry.questionLabel },
              { role: "assistant", content: entry.answer },
            );
          }
          governanceHistoryRef.current = rebuilt;
          return prev;
        });

        // Clear regeneration state
        if (targetEntryId) {
          setRegeneratingEntryId(null);
        }
        pendingQuestionLabelRef.current = null;
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages, regeneratingEntryId]);

  // Load/refresh conversation thread and history when context changes.
  // Also rebuilds governanceHistoryRef from loaded thread entries.
  // When contextKey is null, clear the thread from memory.
  useEffect(() => {
    if (contextKey === null) {
      // No accordion expanded, clear thread from memory
      setConversationThread([]);
      governanceHistoryRef.current = [];
      pendingQuestionLabelRef.current = null;
      threadLoadingRef.current = false;
      setThreadLoaded(true);
      return;
    }

    // Synchronously gate the auto-ask effect in this same cycle.
    // React batches state updates, so setThreadLoaded(false) would only take
    // effect in the next render — too late to prevent auto-ask from firing.
    // The ref is immediately visible to later effects in this cycle.
    threadLoadingRef.current = true;

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
        threadLoadingRef.current = false;
        setThreadLoaded(true);
      })
      .catch(() => {
        // Non-fatal — start fresh if load fails
        setConversationThread([]);
        governanceHistoryRef.current = [];
        pendingQuestionLabelRef.current = null;
        threadLoadingRef.current = false;
        setThreadLoaded(true);
      });
  }, [contextKey]);

  // Persist governance thread after finalization.
  // Saves when: streaming completes, thread has been loaded, there are entries, and contextKey is not null.
  useEffect(() => {
    if (isStreaming || conversationThread.length === 0 || contextKey === null)
      return;

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

  // Reset accordion and activeItem when wizard step changes
  useEffect(() => {
    setExpandedQuestionId(null);
    setActiveItem(null);
  }, [currentStepIndex]);

  // Auto-ask the root question when an accordion is first expanded (empty thread).
  // Uses threadLoadingRef as a synchronous guard to prevent firing during the
  // same effect cycle where the load effect started an async IDB read.
  useEffect(() => {
    if (
      !threadLoaded ||
      threadLoadingRef.current ||
      !expandedQuestionId ||
      conversationThread.length > 0 ||
      isStreaming
    ) {
      return;
    }

    // Find the matching PrebakedQuestion
    const question = findQuestionById(
      expandedQuestionId,
      activeItem,
      currentStepId,
    );
    if (!question) return;

    // Fire the appropriate question
    if (activeItem) {
      askQuestion(question);
    } else {
      askStepQuestion(question);
    }
  }, [
    threadLoaded,
    expandedQuestionId,
    conversationThread.length,
    isStreaming,
    activeItem,
    currentStepId,
    askQuestion,
    askStepQuestion,
  ]);

  // Regenerate a specific entry's answer
  const regenerateAnswer = useCallback(
    async (entryId: string) => {
      // Find the target entry
      const targetEntry = conversationThread.find((e) => e.id === entryId);
      if (!targetEntry) return;

      // Clear the answer to trigger loading state
      setConversationThread((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, answer: "" } : e)),
      );

      // Mark this entry as regenerating
      setRegeneratingEntryId(entryId);

      // Find the matching PrebakedQuestion from its ID
      const question = findQuestionById(
        expandedQuestionId || "",
        activeItem,
        currentStepId,
      );
      if (!question) {
        setRegeneratingEntryId(null);
        return;
      }

      // Build history from entries BEFORE this one only
      const targetIndex = conversationThread.findIndex((e) => e.id === entryId);
      const historyFromBefore: LLMMessage[] = [];
      if (targetIndex > 0) {
        for (let i = 0; i < targetIndex; i++) {
          const entry = conversationThread[i];
          historyFromBefore.push(
            { role: "user", content: entry.questionLabel },
            { role: "assistant", content: entry.answer },
          );
        }
      }

      const truncatedHistory = historyFromBefore.slice(-MAX_HISTORY_MESSAGES);

      // Build and send the prompt
      let prompt: string;
      if (activeItem?.type === "violation") {
        prompt = buildViolationPrompt(question, activeItem.item, wizardContext);
      } else if (activeItem?.type === "suggestion") {
        prompt = buildSuggestionPrompt(
          question,
          activeItem.item,
          wizardContext,
        );
      } else {
        prompt = buildStepPrompt(question, currentStepId, wizardContext);
      }

      pendingQuestionLabelRef.current = question.label;
      await sendGovernanceMessage(
        prompt,
        GOVERNANCE_SYSTEM_PROMPT,
        truncatedHistory,
      );
    },
    [
      conversationThread,
      expandedQuestionId,
      activeItem,
      currentStepId,
      wizardContext,
      sendGovernanceMessage,
    ],
  );

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
    expandedQuestionId,
    expandAccordion,
    regeneratingEntryId,
    regenerateAnswer,
    threadLoaded,
  };
}
