"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";

import { getChatPersistence } from "@/lib/wire";

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
  const [conversationThread, setConversationThread] = useState<
    ConversationEntry[]
  >([]);
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
      setConversationThread([]);
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
          setConversationThread(result.value);
          const rebuilt: LLMRequest["messages"] = [];
          for (const entry of result.value) {
            rebuilt.push(
              { role: "user", content: entry.questionLabel },
              { role: "assistant", content: entry.answer },
            );
          }
          governanceHistoryRef.current = rebuilt;
        } else {
          setConversationThread([]);
          governanceHistoryRef.current = [];
        }
        pendingQuestionLabelRef.current = null;
        threadLoadingRef.current = false;
        setThreadLoaded(true);
        setLoadCompleteToken((prev) => prev + 1);
      })
      .catch(() => {
        setConversationThread([]);
        governanceHistoryRef.current = [];
        pendingQuestionLabelRef.current = null;
        threadLoadingRef.current = false;
        setThreadLoaded(true);
        setLoadCompleteToken((prev) => prev + 1);
      });
  }, [contextKey]);

  // Effect: finalize the thread entry when streaming completes.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      let lastAnswer = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAnswer = messages[i].content;
          break;
        }
      }

      if (lastAnswer) {
        const targetEntryId = regeneratingEntryId;

        setConversationThread((prev) => {
          if (prev.length === 0) return prev;
          if (targetEntryId) {
            // Regeneration: find + overwrite the specific entry.
            const targetIndex = prev.findIndex((e) => e.id === targetEntryId);
            if (targetIndex === -1) return prev;
            const targetEntry = prev[targetIndex];
            if (targetEntry.answer !== "") return prev; // already finalized
            const updated = [...prev];
            updated[targetIndex] = { ...targetEntry, answer: lastAnswer };
            return updated;
          }
          // Normal: append to last entry.
          const last = prev[prev.length - 1];
          if (last.answer) return prev; // already finalized
          return [...prev.slice(0, -1), { ...last, answer: lastAnswer }];
        });

        // Rebuild governanceHistoryRef from the full (post-mutation) thread.
        setConversationThread((prev) => {
          const rebuilt: LLMRequest["messages"] = [];
          for (const entry of prev) {
            rebuilt.push(
              { role: "user", content: entry.questionLabel },
              { role: "assistant", content: entry.answer },
            );
          }
          governanceHistoryRef.current = rebuilt;
          return prev;
        });

        if (targetEntryId) {
          setRegeneratingEntryId(null);
        }
        pendingQuestionLabelRef.current = null;
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages, regeneratingEntryId]);

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
