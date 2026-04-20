"use client";

import { useCallback, useRef, useState } from "react";
import type { SecretVaultPort } from "@hexagen/agentic-interaction";

import { retrieveApiKey } from "./cloud-llm/retrieve-api-key";
import { buildCloudMessageHistory } from "./cloud-llm/build-cloud-history";
import { streamCloudChatResponse } from "./cloud-llm/stream-cloud-chat-response";

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
}

const CHAT_ENDPOINT = "/api/llm/chat";

/**
 * Cloud LLM chat hook. Owns the chat state machine and the send/
 * abort/clear actions. The streaming transport (fetch + SSE parse)
 * lives in ./cloud-llm/stream-cloud-chat-response, parallel to the
 * local LLM's ./local-llm/stream-assistant-response helper.
 *
 * Vault-provided API key is injected via setVault (called by the
 * parent when the vault becomes available) and retrieved
 * just-in-time by each sendMessage.
 */
export function useCloudLLM() {
  const [state, setState] = useState<CloudLLMState>({
    status: "idle",
    messages: [],
    errorMessage: null,
  });

  const vaultRef = useRef<SecretVaultPort | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);

  const setVault = useCallback((vault: SecretVaultPort) => {
    vaultRef.current = vault;
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      config: UseCloudLLMConfig,
      systemPrompt?: string,
    ) => {
      if (isStreamingRef.current) return;
      if (!config.provider || !config.model) return;

      // 1. Retrieve API key from vault.
      const keyResult = await retrieveApiKey(vaultRef.current);
      if (!keyResult.success) {
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: keyResult.message,
        }));
        return;
      }

      isStreamingRef.current = true;

      // 2. Snapshot prior messages BEFORE the setState below, so
      // buildCloudMessageHistory sees the pre-send state (avoids the
      // batching-dependent snapshot trick in the original code).
      const priorMessages = state.messages;
      const now = Date.now();
      const assistantId = `assistant-${now}`;

      setState((prev) => ({
        ...prev,
        status: "streaming",
        errorMessage: null,
        messages: [
          ...prev.messages,
          { id: `user-${now}`, role: "user", content, timestamp: now },
          { id: assistantId, role: "assistant", content: "", timestamp: now },
        ],
      }));

      // 3. Build the LLM-facing history.
      const historyMessages = buildCloudMessageHistory(
        priorMessages,
        content,
        systemPrompt,
      );

      // 4. Fetch + stream.
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyMessages,
            provider: config.provider,
            model: config.model,
            apiKey: keyResult.apiKey,
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

        await streamCloudChatResponse({
          response,
          assistantId,
          setState,
        });
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
    [state.messages],
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
    setVault,
  };
}
