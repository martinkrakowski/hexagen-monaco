"use client";

import { useEffect } from "react";

import {
  findQuestionById,
  type PrebakedQuestion,
  type WizardStepId,
} from "@/lib/governance-question-templates";

import type { ActiveItem, ConversationEntry } from "./types";

interface UseAutoAskOnExpandOptions {
  threadLoaded: boolean;
  threadLoadingRef: React.MutableRefObject<boolean>;
  loadCompleteToken: number;

  expandedQuestionId: string | null;
  conversationThread: ConversationEntry[];
  isStreaming: boolean;

  activeItem: ActiveItem | null;
  currentStepId: WizardStepId;

  askQuestion: (question: PrebakedQuestion) => Promise<void>;
  askStepQuestion: (question: PrebakedQuestion) => Promise<void>;
}

/**
 * Auto-asks the root question when a user expands an accordion for
 * the first time (empty thread + no pending stream). Gated by both
 * the threadLoaded state flag AND the synchronous threadLoadingRef
 * so the effect cannot fire in the same cycle the load effect began.
 *
 * loadCompleteToken is a dep to force re-evaluation when the load
 * effect completes — the thread might have been loaded from IDB
 * with prior content, in which case we should NOT auto-ask (handled
 * by the conversationThread.length > 0 guard).
 */
export function useAutoAskOnExpand(options: UseAutoAskOnExpandOptions): void {
  const {
    threadLoaded,
    threadLoadingRef,
    loadCompleteToken,
    expandedQuestionId,
    conversationThread,
    isStreaming,
    activeItem,
    currentStepId,
    askQuestion,
    askStepQuestion,
  } = options;

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

    const question = findQuestionById(
      expandedQuestionId,
      activeItem,
      currentStepId,
    );
    if (!question) return;

    if (activeItem) {
      askQuestion(question);
    } else {
      askStepQuestion(question);
    }
  }, [
    threadLoaded,
    threadLoadingRef,
    expandedQuestionId,
    conversationThread.length,
    isStreaming,
    activeItem,
    currentStepId,
    askQuestion,
    askStepQuestion,
    loadCompleteToken,
  ]);
}
