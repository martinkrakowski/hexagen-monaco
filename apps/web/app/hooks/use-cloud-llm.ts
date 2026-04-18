"use client";

import { useState, useRef, useCallback } from "react";

export interface CloudChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export type CloudLLMStatus = "idle" | "streaming" | "error";

export interface CloudLLMState {
  status: CloudLLMStatus;
  messages: CloudChatMessage[];
  errorMessage: string | null;
}

export interface UseCloudLLMConfig {
  provider: string;
  model: string;
  apiKey: string;
}

const CHAT_ENDPOINT = "/api/llm/chat";

export function useCloudLLM() {
  const [state, setState] = useState<CloudLLMState>({
    status: "idle",
    messages: [],
    errorMessage: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);

  const sendMessage = useCallback(
    async (
      content: string,
      config: UseCloudLLMConfig,
      systemPrompt?: string,
    ) => {
      if (isStreamingRef.current) return;
      if (!config.apiKey || !config.provider || !config.model) return;

      isStreamingRef.current = true;

      const userMessage: CloudChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };

      const assistantMessage: CloudChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setState((prev) => ({
        ...prev,
        status: "streaming",
        errorMessage: null,
        messages: [...prev.messages, userMessage, assistantMessage],
      }));

      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [];

      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }

      setState((prev) => {
        const historyMessages = prev.messages
          .filter((m) => m.role !== "system")
          .slice(0, -1)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
        messages.push(...historyMessages, { role: "user", content });
        return prev;
      });

      messages.push({ role: "user", content });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const assistantId = assistantMessage.id;

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages:
              messages.length > 1 ? messages : [{ role: "user", content }],
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            temperature: 0.7,
            maxTokens: 2048,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          let errorMsg = `HTTP ${response.status}`;
          try {
            const errorBody = await response.json();
            errorMsg = errorBody.error ?? errorMsg;
          } catch {
            // ignore JSON parse errors on error responses
          }
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: errorMsg,
            messages: prev.messages.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Error: ${errorMsg}` }
                : m,
            ),
          }));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: "No response body",
          }));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            let parsed: { type: string; content?: string; message?: string };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }

            if (parsed.type === "chunk" && parsed.content) {
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.content }
                    : m,
                ),
              }));
            } else if (parsed.type === "error") {
              setState((prev) => ({
                ...prev,
                status: "error",
                errorMessage: parsed.message ?? "Unknown error",
                messages: prev.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: `Error: ${parsed.message ?? "Unknown error"}`,
                      }
                    : m,
                ),
              }));
              return;
            } else if (parsed.type === "done") {
              setState((prev) => ({ ...prev, status: "idle" }));
              return;
            }
          }
        }

        setState((prev) => ({ ...prev, status: "idle" }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setState((prev) => ({ ...prev, status: "idle" }));
          return;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: errorMsg,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m,
          ),
        }));
      } finally {
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isStreamingRef.current = false;
    setState((prev) => ({ ...prev, status: "idle" }));
  }, []);

  const clearMessages = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [],
      errorMessage: null,
      status: "idle",
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      errorMessage: null,
      status: "idle",
    }));
  }, []);

  return {
    ...state,
    sendMessage,
    abort,
    clearMessages,
    clearError,
  };
}
