"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  LLMMessage,
  LocalLLMProviderPort,
} from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

import { getChatPersistence } from "@/lib/wire";
import {
  buildGroundedSystemPrompt,
  chunkEditorBuffer,
  estimateTokens,
  prunedHistoryWindow,
  type EditorState as EditorContextState,
  type GovernancePayload,
} from "@/lib/grounded-prompt";

import { streamAssistantResponse } from "./stream-assistant-response";

interface UseChatMessagesOptions {
  adapterRef: React.MutableRefObject<LocalLLMProviderPort | null>;
  governancePayload: GovernancePayload | null;
  editorStateRef: React.MutableRefObject<EditorContextState>;
}

export interface UseChatMessagesReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
    history?: LLMMessage[],
  ) => Promise<void>;
  clearMessages: () => void;
}

/**
 * Chat message state + two send methods + persistence.
 *
 * The two send methods differ only in how the system prompt is
 * constructed:
 *   - sendMessage builds a grounded prompt from governance + editor
 *   - sendGovernanceMessage accepts the prompt and history as args
 *     (used by the governance panel which owns its own prompt logic)
 *
 * Both share the streaming loop (streamAssistantResponse) and the
 * user/assistant message plumbing (appendUserAndPlaceholder below).
 *
 * Persistence:
 *   - Mount: load history from IndexedDB, seed messages state
 *   - Post-load, not-streaming, non-empty: save on every message change
 *
 * An isStreamingRef mirrors isStreaming synchronously so rapid back-
 * to-back send calls can short-circuit before React commits the state
 * change (single-send invariant).
 */
export function useChatMessages({
  adapterRef,
  governancePayload,
  editorStateRef,
}: UseChatMessagesOptions): UseChatMessagesReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);

  const messagesRef = useRef<ChatMessage[]>([]);
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load chat history on mount.
  useEffect(() => {
    if (isHistoryLoaded) return;
    const port = getChatPersistence();
    port
      .loadChatHistory()
      .then((result: Result<ChatMessage[]>) => {
        if (result.success && result.value.length > 0) {
          setMessages(result.value);
        }
        setIsHistoryLoaded(true);
      })
      .catch(() => {
        // Non-fatal — allow the app to proceed even if load fails.
        setIsHistoryLoaded(true);
      });
  }, [isHistoryLoaded]);

  // Persist chat history when streaming completes and history is loaded.
  // Only saves after initial load to avoid persisting partial states.
  useEffect(() => {
    if (!isHistoryLoaded || isStreaming || messages.length === 0) return;
    const port = getChatPersistence();
    port.saveChatHistory(messages).catch(() => {
      // eslint-disable-next-line no-console
      console.warn("Failed to save chat history");
    });
  }, [isHistoryLoaded, isStreaming, messages]);

  /** Appends a user message + an empty assistant placeholder; returns the placeholder id. */
  const appendUserAndPlaceholder = useCallback((content: string): string => {
    const now = Date.now();
    const assistantMessageId = `assistant-${now}`;
    setMessages((prev) => [
      ...prev,
      { id: `user-${now}`, role: "user", content, timestamp: now },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: now,
      },
    ]);
    return assistantMessageId;
  }, []);

  /** Writes an error string into the placeholder assistant message. */
  const writeErrorIntoPlaceholder = useCallback(
    (assistantMessageId: string, err: unknown) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.id === assistantMessageId) {
          last.content =
            err instanceof Error ? err.message : "An error occurred";
        }
        return next;
      });
    },
    [],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;
      setIsStreaming(true);

      const assistantMessageId = appendUserAndPlaceholder(content);
      abortControllerRef.current = new AbortController();

      try {
        // Build a grounded system prompt from governance + editor
        // context. Fall back to a generic prompt if construction fails
        // (missing governance payload, prompt overflow, etc.).
        let systemPrompt: string;
        try {
          if (!governancePayload) {
            throw new Error("Governance context not loaded");
          }
          const { content: editorChunk, lineEnd } = chunkEditorBuffer(
            editorStateRef.current.content,
            5120,
          );
          const editorContext = {
            ...editorStateRef.current,
            content: editorChunk,
            lineEnd,
          };
          systemPrompt = buildGroundedSystemPrompt({
            governance: governancePayload,
            editor: editorContext,
          });

          const totalTokens =
            estimateTokens(systemPrompt) + estimateTokens(content) + 200;
          const maxTokens = adapter.getLoadedModel()?.contextLength || 32768;
          if (totalTokens > maxTokens * 0.9) {
            throw new Error(
              `System prompt + message (${totalTokens} tokens) exceeds safe limit`,
            );
          }
        } catch (promptError) {
          // eslint-disable-next-line no-console
          console.warn("Failed to build grounded prompt:", promptError);
          systemPrompt =
            "You are HexaGen Monaco AI. Assist with the architecture project.";
        }

        const pruned = prunedHistoryWindow(
          messagesRef.current,
          systemPrompt,
          content,
          adapter.getLoadedModel()?.contextLength || 32768,
        );

        const llmMessages: LLMMessage[] = [
          { role: "system", content: systemPrompt },
          ...pruned,
          { role: "user", content },
        ];

        await streamAssistantResponse({
          adapter,
          messages: llmMessages,
          assistantMessageId,
          abortController: abortControllerRef.current,
          setMessages,
        });
      } catch (error: unknown) {
        writeErrorIntoPlaceholder(assistantMessageId, error);
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [
      adapterRef,
      governancePayload,
      editorStateRef,
      appendUserAndPlaceholder,
      writeErrorIntoPlaceholder,
    ],
  );

  const sendGovernanceMessage = useCallback(
    async (content: string, systemPrompt: string, history?: LLMMessage[]) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;
      setIsStreaming(true);

      const assistantMessageId = appendUserAndPlaceholder(content);
      abortControllerRef.current = new AbortController();

      try {
        const llmMessages: LLMMessage[] = history
          ? [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user", content },
            ]
          : [
              { role: "system", content: systemPrompt },
              { role: "user", content },
            ];

        await streamAssistantResponse({
          adapter,
          messages: llmMessages,
          assistantMessageId,
          abortController: abortControllerRef.current,
          setMessages,
        });
      } catch (error: unknown) {
        writeErrorIntoPlaceholder(assistantMessageId, error);
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [adapterRef, appendUserAndPlaceholder, writeErrorIntoPlaceholder],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    sendGovernanceMessage,
    clearMessages,
  };
}
