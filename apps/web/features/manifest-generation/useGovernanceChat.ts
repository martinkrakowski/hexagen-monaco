"use client";

import { useCallback, useRef, useState } from "react";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
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
 *
 * Every send is tagged with a monotonic request id; a `reset` send (a context
 * switch) preempts an in-flight stream, and only the *current* request may
 * mutate state or clear the streaming refs — so an aborted/superseded request
 * settling late can't flip a newer stream back to idle or null its controller.
 */
export function useGovernanceChat() {
  const [state, setState] = useState<ChatState>({
    status: "idle",
    messages: [],
    errorMessage: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const requestIdRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>(state.messages);
  messagesRef.current = state.messages;

  const sendMessage = useCallback(
    async (content: string, { model, systemPrompt, reset }: SendOptions) => {
      if (isStreamingRef.current) {
        // A follow-up can't preempt a live stream (the input is disabled while
        // streaming). A context switch (`reset`) preempts: abort the in-flight
        // request so the new context gets seeded.
        if (!reset) return;
        abortControllerRef.current?.abort();
      }

      const requestId = ++requestIdRef.current;
      const isCurrent = () => requestIdRef.current === requestId;

      const priorMessages = reset ? [] : messagesRef.current;
      // Derive message ids from the monotonic requestId (not Date.now(), which
      // collides for sends within the same millisecond → duplicate React keys).
      const assistantId = `assistant-${requestId}`;
      const userMessage: ChatMessage = {
        id: `user-${requestId}`,
        role: "user",
        content,
      };
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      // Wire-facing history: prior non-system turns, then the new user message
      // with the grounding folded in. We deliberately do NOT send a separate
      // `system` message: the cloud chat model (mercury) returns an empty
      // completion far more often for a [system, user] pair than for a single
      // grounded user turn, so folding the grounding into the user message
      // markedly cuts the empty-output rate (the server still retries on empty).
      const groundedContent = systemPrompt
        ? `${systemPrompt}\n\n${content}`
        : content;
      const wireMessages = [
        ...priorMessages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: groundedContent },
      ];

      isStreamingRef.current = true;
      setState((prev) => ({
        status: "streaming",
        errorMessage: null,
        messages: reset
          ? [userMessage, assistantPlaceholder]
          : [...prev.messages, userMessage, assistantPlaceholder],
      }));

      const appendToAssistant = (chunk: string) => {
        if (!isCurrent()) return;
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m,
          ),
        }));
      };

      const failAssistant = (message: string) => {
        if (!isCurrent()) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: message,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${message}` } : m,
          ),
        }));
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetchWithCsrf(CHAT_ENDPOINT, {
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

        // Returns true when a terminal frame (done/error) was seen.
        const handleDataLine = (line: string): boolean => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) return false;
          let frame: { type?: string; content?: string; message?: string };
          try {
            frame = JSON.parse(trimmed.slice(6));
          } catch {
            return false;
          }
          if (frame.type === "chunk" && frame.content) {
            appendToAssistant(frame.content);
            return false;
          }
          if (frame.type === "error") {
            failAssistant(frame.message ?? "Unknown error");
            return true;
          }
          return frame.type === "done";
        };

        while (!done) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (handleDataLine(line)) {
              done = true;
              break;
            }
          }
        }

        // Flush any trailing frame the server emitted without a final newline —
        // otherwise a terminal `done`/`error` (or last chunk) could be dropped.
        if (!done) {
          buffer += decoder.decode();
          for (const line of buffer.split("\n")) {
            if (handleDataLine(line)) break;
          }
        }

        if (isCurrent()) {
          setState((prev) => {
            if (prev.status === "error") return prev;
            // Defense in depth: if the stream finished without an error frame but
            // the assistant turn is still empty (a provider that returned no
            // content — or the BYOK path, which doesn't go through the server's
            // empty-output retry), surface it instead of leaving a silent blank
            // bubble. The server path already retries + emits an error frame; this
            // catches everything else.
            const assistant = prev.messages.find((m) => m.id === assistantId);
            if (assistant && assistant.content.trim() === "") {
              const message =
                "The model returned no response. Please try again.";
              return {
                ...prev,
                status: "error",
                errorMessage: message,
                messages: prev.messages.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `Error: ${message}` }
                    : m,
                ),
              };
            }
            return { ...prev, status: "idle" };
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // The request was aborted (Stop, or preempted by a context switch).
          // Only the *current* request may reset status to idle.
          if (isCurrent()) setState((prev) => ({ ...prev, status: "idle" }));
          return;
        }
        failAssistant(error instanceof Error ? error.message : String(error));
      } finally {
        // Only the current request owns the streaming refs — a superseded
        // request settling late must not clear a newer stream's controller.
        if (isCurrent()) {
          isStreamingRef.current = false;
          abortControllerRef.current = null;
        }
      }
    },
    [],
  );

  const abort = useCallback(() => {
    // Bump the id so the in-flight request's late settle is ignored, then abort.
    requestIdRef.current += 1;
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
