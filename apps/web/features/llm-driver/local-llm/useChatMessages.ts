"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  DomainModelId,
  LLMRequest,
  ModelLifecyclePort,
  SendStructuredRequestPort,
} from "@hexagen/local-llm";
import {
  DEFAULT_TUNING_CONFIG,
  FreeFormStringSchema,
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
} from "@hexagen/prompt-compiler";

import { streamAssistantResponse } from "./stream-assistant-response";

type LocalLLMAdapter = ModelLifecyclePort & SendStructuredRequestPort;

interface UseChatMessagesOptions {
  adapterRef: React.MutableRefObject<LocalLLMAdapter | null>;
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
    history?: LLMRequest["messages"],
  ) => Promise<void>;
  sendStructuredPrompt: (
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  clearMessages: () => void;
}

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
        setIsHistoryLoaded(true);
      });
  }, [isHistoryLoaded]);

  useEffect(() => {
    if (!isHistoryLoaded || isStreaming || messages.length === 0) return;
    const port = getChatPersistence();
    port.saveChatHistory(messages).catch(() => {
      console.warn("Failed to save chat history");
    });
  }, [isHistoryLoaded, isStreaming, messages]);

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

        const requestMessages: LLMRequest["messages"] = [
          { role: "system", content: systemPrompt },
          ...pruned,
          { role: "user", content },
        ];

        await streamAssistantResponse({
          adapter,
          modelId:
            adapter.getLoadedModel()?.modelId ??
            ("qwen-coder-3b" as DomainModelId),
          messages: requestMessages,
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
    async (
      content: string,
      systemPrompt: string,
      history?: LLMRequest["messages"],
    ) => {
      const adapter = adapterRef.current;
      if (!adapter) {
        throw new Error(
          "Engine not initialized. Call initializeModel() before sending messages.",
        );
      }
      if (isStreamingRef.current) {
        throw new Error(
          "A stream is already in progress. Wait for it to complete.",
        );
      }
      isStreamingRef.current = true;
      setIsStreaming(true);

      const assistantMessageId = appendUserAndPlaceholder(content);
      abortControllerRef.current = new AbortController();

      try {
        const requestMessages: LLMRequest["messages"] = history
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
          modelId:
            adapter.getLoadedModel()?.modelId ??
            ("qwen-coder-3b" as DomainModelId),
          messages: requestMessages,
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

  const sendStructuredPrompt = useCallback(
    async (
      userPrompt: string,
      systemPrompt: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      const adapter = adapterRef.current;
      if (!adapter) {
        throw new Error("Engine not initialized.");
      }
      if (isStreamingRef.current) {
        throw new Error("A stream is already in progress.");
      }

      const requestMessages: LLMRequest["messages"] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      let collected = "";

      const request: LLMRequest = {
        id: `manifest-${Date.now()}`,
        modelId:
          adapter.getLoadedModel()?.modelId ??
          ("qwen-coder-3b" as DomainModelId),
        messages: requestMessages,
        schema: FreeFormStringSchema,
        temperature: DEFAULT_TUNING_CONFIG.temperature,
        maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
        topP: DEFAULT_TUNING_CONFIG.topP,
        stream: true,
      };

      const stream = adapter.streamStructuredRequest(request);

      for await (const result of stream) {
        if (signal?.aborted) break;
        if (result.success) {
          collected += result.value;
        } else {
          throw result.error;
        }
      }

      if (!collected) throw new Error("No response from model.");
      return collected;
    },
    [adapterRef],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    sendGovernanceMessage,
    sendStructuredPrompt,
    clearMessages,
  };
}
