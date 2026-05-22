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

import { getChatPersistence, hasServerLLMAccessKey } from "@/lib/wire";
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
      // Silently handle chat history save failures to avoid blocking user interaction
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
        } catch {
          // Fallback to generic prompt if grounded prompt fails
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

      try {
        // When no local model is loaded but the server ENV LLM is available,
        // route through the server proxy to avoid "Engine not initialized" errors.
        if (!adapter.getLoadedModel() && hasServerLLMAccessKey()) {
          const response = await fetch("/api/llm/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: requestMessages,
              model: process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini",
              temperature: DEFAULT_TUNING_CONFIG.temperature,
              maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            let errMsg = `Server LLM error: ${response.status}`;
            try {
              const errBody = (await response.json()) as { error?: string };
              if (errBody.error) errMsg = errBody.error;
            } catch {
              // fallback to status-based message
            }
            throw new Error(errMsg);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error("No response body from server LLM");
          const decoder = new TextDecoder();
          let buffer = "";

          let reading = true;
          while (reading) {
            const { done, value } = await reader.read();
            if (done || abortControllerRef.current?.signal.aborted) {
              reading = false;
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              try {
                const parsed = JSON.parse(data) as {
                  type: string;
                  content?: string;
                  message?: string;
                };
                if (parsed.type === "chunk" && parsed.content) {
                  const chunk = parsed.content;
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (!last || last.id !== assistantMessageId) return prev;
                    return [
                      ...prev.slice(0, -1),
                      { ...last, content: last.content + chunk },
                    ];
                  });
                } else if (parsed.type === "error") {
                  throw new Error(parsed.message ?? "Server LLM error");
                } else if (parsed.type === "done") {
                  break outer;
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        } else {
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
        }
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
