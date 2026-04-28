"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";

import { getChatPersistence } from "@/lib/wire";
import { useGovernanceThreadStore } from "../../stores/useGovernanceThreadStore";

import type { ConversationEntry } from "./types";

interface UseGovernanceThreadOptions {
  contextKey: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
}

export interface UseGovernanceThreadReturn {
  conversationThread: ConversationEntry[];
  setConversationThread: React.Dispatch<
    React.SetStateAction<ConversationEntry[]>
  >;

  /** Ref with current LLM history (question label + answer pairs) — used to seed new asks. */
  governanceHistoryRef: React.MutableRefObject<LLMRequest["messages"]>;

  /** Label of the currently streaming question; null between asks. */
  pendingQuestionLabelRef: React.MutableRefObject<string | null>;

  /** Id of the entry being regenerated; null during normal asks. */
  regeneratingEntryId: string | null;
  setRegeneratingEntryId: React.Dispatch<React.SetStateAction<string | null>>;

  /** True once the initial IDB load for the current contextKey has resolved. */
  threadLoaded: boolean;

  /**
   * Synchronously-gated flag consumed by the auto-ask effect. Unlike
   * threadLoaded state (batched, only visible next render), this ref
   * is set immediately when the load effect starts, preventing
   * auto-ask from firing in the same effect cycle.
   */
  threadLoadingRef: React.MutableRefObject<boolean>;

  /**
   * Increments each time the load effect completes. Consumers can
   * depend on this to re-run effects when thread contents change
   * via load rather than via ask (contents identity changes but
   * contextKey may not).
   */
  loadCompleteToken: number;
}

/**
 * Owns the governance conversation thread for the current context.
 * Three effects coordinated here:
 *
 *   1. Load: on contextKey change, fetch the thread from IDB,
 *      rebuild governanceHistoryRef, and flip threadLoaded true.
 *      Clears thread + history when contextKey becomes null.
 *   2. Finalize: on isStreaming edge (was true, now false), commit
 *      the final streamed answer into the thread entry (either
 *      the last entry or a specific regeneration target).
 *   3. Persist: when not streaming and thread is non-empty, save
 *      to IDB under contextKey (fire-and-forget).
 *
 * The finalize effect has dual-mode: normal (append to last entry)
 * vs regeneration (find specific entry by id). Edge detection uses
 * wasStreamingRef to guarantee exactly-once finalization per stream.
 */
export function useGovernanceThread({
  contextKey,
  messages,
  isStreaming,
}: UseGovernanceThreadOptions): UseGovernanceThreadReturn {
  // Use Zustand store for thread state (survives unmount/remount)
  const { getThread, setThread, updateEntry } = useGovernanceThreadStore();

  const conversationThread = contextKey ? getThread(contextKey) : [];

  const [regeneratingEntryId, setRegeneratingEntryId] = useState<string | null>(
    null,
  );
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [loadCompleteToken, setLoadCompleteToken] = useState(0);

  const governanceHistoryRef = useRef<LLMRequest["messages"]>([]);
  const pendingQuestionLabelRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);
  const threadLoadingRef = useRef(false);

  // Effect: load thread on contextKey change.
  useEffect(() => {
    if (contextKey === null) {
      governanceHistoryRef.current = [];
      pendingQuestionLabelRef.current = null;
      threadLoadingRef.current = false;
      setThreadLoaded(true);
      return;
    }

    // Synchronously gate the auto-ask effect in this same cycle.
    // React batches state updates, so setThreadLoaded(false) would
    // only take effect in the next render — too late. The ref is
    // immediately visible to later effects in this cycle.
    threadLoadingRef.current = true;

    const port = getChatPersistence();
    port
      .loadGovernanceThread(contextKey)
      .then((result) => {
        if (result.success) {
          setThread(contextKey, result.value);
          const rebuilt: LLMRequest["messages"] = [];
          for (const entry of result.value) {
            rebuilt.push(
              { role: "user", content: entry.questionLabel },
              { role: "assistant", content: entry.answer },
            );
          }
          governanceHistoryRef.current = rebuilt;
        } else {
          setThread(contextKey, []);
          governanceHistoryRef.current = [];
        }
        pendingQuestionLabelRef.current = null;
        threadLoadingRef.current = false;
        setThreadLoaded(true);
        setLoadCompleteToken((prev) => prev + 1);
      })
      .catch(() => {
        setThread(contextKey, []);
        governanceHistoryRef.current = [];
        pendingQuestionLabelRef.current = null;
        threadLoadingRef.current = false;
        setThreadLoaded(true);
        setLoadCompleteToken((prev) => prev + 1);
      });
  }, [contextKey, setThread]);

  // Effect: finalize the thread entry when streaming completes.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && contextKey) {
      let lastAnswer = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAnswer = messages[i].content;
          break;
        }
      }

      if (lastAnswer) {
        const targetEntryId = regeneratingEntryId;
        const currentThread = getThread(contextKey);

        if (currentThread.length === 0) {
          wasStreamingRef.current = isStreaming;
          return;
        }

        if (targetEntryId) {
          // Regeneration: find + overwrite the specific entry.
          const targetIndex = currentThread.findIndex(
            (e) => e.id === targetEntryId,
          );
          if (targetIndex !== -1) {
            const targetEntry = currentThread[targetIndex];
            if (targetEntry.answer === "") {
              updateEntry(contextKey, targetEntryId, (entry) => {
                entry.answer = lastAnswer;
              });
            }
          }
          setRegeneratingEntryId(null);
        } else {
          // Normal: append to last entry.
          const last = currentThread[currentThread.length - 1];
          if (!last.answer) {
            updateEntry(contextKey, last.id, (entry) => {
              entry.answer = lastAnswer;
            });
          }
        }

        // Rebuild governanceHistoryRef from the updated thread.
        const updatedThread = getThread(contextKey);
        const rebuilt: LLMRequest["messages"] = [];
        for (const entry of updatedThread) {
          rebuilt.push(
            { role: "user", content: entry.questionLabel },
            { role: "assistant", content: entry.answer },
          );
        }
        governanceHistoryRef.current = rebuilt;

        pendingQuestionLabelRef.current = null;
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [
    isStreaming,
    messages,
    regeneratingEntryId,
    contextKey,
    getThread,
    updateEntry,
  ]);

  // Effect: persist thread after finalization.
  useEffect(() => {
    if (isStreaming || conversationThread.length === 0 || contextKey === null) {
      return;
    }
    const port = getChatPersistence();
    port.saveGovernanceThread(contextKey, conversationThread).catch(() => {
      // Silently swallow persistence failures — non-critical path
    });
  }, [contextKey, isStreaming, conversationThread]);

  // Provide a setConversationThread wrapper for backward compatibility
  // with existing consumers (useGovernanceQuestionActions).
  const setConversationThread = (
    updater:
      | ConversationEntry[]
      | ((prev: ConversationEntry[]) => ConversationEntry[]),
  ) => {
    if (!contextKey) return;

    if (typeof updater === "function") {
      const currentThread = getThread(contextKey);
      const newThread = updater(currentThread);
      setThread(contextKey, newThread);
    } else {
      setThread(contextKey, updater);
    }
  };

  return {
    conversationThread,
    setConversationThread,
    governanceHistoryRef,
    pendingQuestionLabelRef,
    regeneratingEntryId,
    setRegeneratingEntryId,
    threadLoaded,
    threadLoadingRef,
    loadCompleteToken,
  };
}
