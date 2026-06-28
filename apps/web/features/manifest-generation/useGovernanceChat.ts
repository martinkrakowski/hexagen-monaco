"use client";

import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

type ChatStatus = "idle" | "streaming" | "error";

interface ChatState {
  status: ChatStatus;
  messages: ChatMessage[];
  errorMessage: string | null;
}

interface SendOptions {
  /** Display/requested model (the server path uses LLM_MODEL regardless). */
  model: string;
  /** Grounding system prompt prepended to the history. */
  systemPrompt?: string;
  /** Start a fresh conversation — used for the seed question on a new context. */
  reset?: boolean;
}

const CHAT_ENDPOINT = "/api/llm/chat";

/**
 * Self-contained streaming chat hook for the accept-view context drawer.
 *
 * It hits `/api/llm/chat` on its server-key path (no BYOK ciphertext, no client
 * `apiKey`): the route uses the server's configured LLM key and enforces the
 * free-tier daily chat quota for anonymous sessions — so this works for both
 * signed-in and anonymous users (who can reach the accept view). The
 * governance-assistant feature has a similar cloud hook, but it (a) lives in a
 * different feature slice (feature-isolation rule forbids importing it) and
 * (b) requires a client-side key, so it can't serve free-tier users.
 */
export function useGovernanceChat() {
  const [state, setState] = useState<ChatState>({
    status: "idle",
    messages: [],
    errorMessage: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(state.messages);
  messagesRef.current = state.messages;

  const sendMessage = useCallback(
    async (content: string, { model, systemPrompt, reset }: SendOptions) => {
      if (isStreamingRef.current) return;

      const priorMessages = reset ? [] : messagesRef.current;
      const now = Date.now();
      const assistantId = `assistant-${now}`;
      const userMessage: ChatMessage = {
        id: `user-${now}`,
        role: "user",
        content,
      };
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      // Wire-facing history: optional system prompt, prior non-system turns, the
      // new user message.
      const wireMessages = [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...priorMessages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content },
      ];

      isStreamingRef.current = true;
      setState((prev) => ({
        status: "streaming",
        errorMessage: null,
        messages: reset
          ? [userMessage, assistantPlaceholder]
          : [...prev.messages, userMessage, assistantPlaceholder],
      }));

      const appendToAssistant = (chunk: string) =>
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m,
          ),
        }));

      const failAssistant = (message: string) =>
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: message,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${message}` } : m,
          ),
        }));

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: wireMessages,
            model,
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
            // Ignore JSON parse errors on error responses.
          }
          failAssistant(errorMsg);
          return;
        }

        // Parse the `data: {type,content|message}` SSE frames the route emits.
        const reader = response.body?.getReader();
        if (!reader) {
          failAssistant("No response body");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            let frame: { type?: string; content?: string; message?: string };
            try {
              frame = JSON.parse(trimmed.slice(6));
            } catch {
              continue;
            }
            if (frame.type === "chunk" && frame.content) {
              appendToAssistant(frame.content);
            } else if (frame.type === "error") {
              failAssistant(frame.message ?? "Unknown error");
              done = true;
              break;
            } else if (frame.type === "done") {
              done = true;
              break;
            }
          }
        }
        setState((prev) =>
          prev.status === "error" ? prev : { ...prev, status: "idle" },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setState((prev) => ({ ...prev, status: "idle" }));
          return;
        }
        failAssistant(error instanceof Error ? error.message : String(error));
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
    setState({ status: "idle", messages: [], errorMessage: null });
  }, []);

  return { ...state, sendMessage, abort, clearMessages };
}
