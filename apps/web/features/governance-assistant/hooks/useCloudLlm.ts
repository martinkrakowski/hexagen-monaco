"use client";

import { useCallback, useRef, useState } from "react";
import type { UserSecretVaultPort, ByokStore } from "@hexagen/web-driver";
import type { ByokProvider } from "@hexagen/byok";

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

export function useCloudLLM() {
  const [state, setState] = useState<CloudLLMState>({
    status: "idle",
    messages: [],
    errorMessage: null,
  });

  const vaultRef = useRef<UserSecretVaultPort | null>(null);
  const byokStoreRef = useRef<ByokStore | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;

  const setVault = useCallback((vault: UserSecretVaultPort) => {
    vaultRef.current = vault;
  }, []);

  const setByokStore = useCallback((store: ByokStore) => {
    byokStoreRef.current = store;
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      config: UseCloudLLMConfig,
      systemPrompt?: string,
    ) => {
      if (isStreamingRef.current) return;
      if (!config.provider || !config.model) return;

      let byokCiphertext: string | undefined;
      let byokProvider: ByokProvider | undefined;

      if (byokStoreRef.current) {
        const entry = byokStoreRef.current.getEntry(
          config.provider as ByokProvider,
        );
        if (entry) {
          byokCiphertext = entry.ciphertext;
          byokProvider = entry.provider;
        }
      }

      if (!byokCiphertext) {
        const keyResult = await retrieveApiKey(vaultRef.current);
        if (!keyResult.success) {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: keyResult.message,
          }));
          return;
        }
      }

      isStreamingRef.current = true;

      const priorMessages = messagesRef.current;
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

      const historyMessages = buildCloudMessageHistory(
        priorMessages,
        content,
        systemPrompt,
      );

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const requestBody: Record<string, unknown> = {
          messages: historyMessages,
          provider: config.provider,
          model: config.model,
          temperature: 0.7,
          maxTokens: 2048,
        };

        if (byokCiphertext && byokProvider) {
          requestBody.byokCiphertext = byokCiphertext;
          requestBody.byokProvider = byokProvider;
        } else {
          const keyResult = await retrieveApiKey(vaultRef.current);
          requestBody.apiKey = keyResult.success ? keyResult.apiKey : "";
        }

        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
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

        const rotatedCiphertext = response.headers.get(
          "X-Byok-Rotated-Ciphertext",
        );
        if (rotatedCiphertext && byokStoreRef.current && byokProvider) {
          byokStoreRef.current.setEntry({
            ciphertext: rotatedCiphertext,
            provider: byokProvider,
            keyId: `rotated-${Date.now()}`,
            createdAt: new Date().toISOString(),
          });
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
    setVault,
    setByokStore,
  };
}
