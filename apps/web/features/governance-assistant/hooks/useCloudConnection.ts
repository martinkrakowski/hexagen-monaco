"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserSecretVaultPort } from "@hexagen/web-driver";
import type { UseCloudLLMConfig } from "./useCloudLlm";

/**
 * Finite State Machine for Cloud LLM connection lifecycle.
 * States: IDLE -> CONNECTING -> CONNECTED | ERROR
 *
 * Implements:
 * - Timeout guards (10s for vault operations)
 * - Exponential backoff retry logic
 * - AbortController for cancellation
 * - Error boundary with actionable messages
 */

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface ConnectionError {
  message: string;
  retryable: boolean;
  retryCount: number;
}

interface UseCloudConnectionState {
  state: ConnectionState;
  config: UseCloudLLMConfig | null;
  error: ConnectionError | null;
}

const CONNECTION_TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000; // 1 second

/**
 * Calculate exponential backoff delay: 1s, 2s, 4s
 */
function calculateRetryDelay(attemptNumber: number): number {
  return BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber);
}

/**
 * Wrap a promise with a timeout that rejects if not resolved within timeoutMs.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

export function useCloudConnection() {
  const [connectionState, setConnectionState] =
    useState<UseCloudConnectionState>({
      state: "idle",
      config: null,
      error: null,
    });

  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectRef = useRef<
    | ((
        provider: string,
        model: string,
        vault: UserSecretVaultPort | null,
        retryCount?: number,
      ) => Promise<void>)
    | null
  >(null);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Attempt to connect to Cloud LLM with timeout and retry logic.
   */
  const connect = useCallback(
    async (
      provider: string,
      model: string,
      vault: UserSecretVaultPort | null,
      retryCount = 0,
    ): Promise<void> => {
      // Prevent concurrent connection attempts
      if (connectionState.state === "connecting") {
        return;
      }

      setConnectionState({
        state: "connecting",
        config: null,
        error: null,
      });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Validate vault availability
        if (!vault) {
          throw new Error(
            "Secret vault not initialized. Please refresh the page and try again.",
          );
        }

        // Wrap vault.store operation with timeout
        const storeResult = await withTimeout(
          vault.retrieve(),
          CONNECTION_TIMEOUT_MS,
          "Connection timeout: Vault operation took too long. Please try again.",
        );

        // Check if aborted during async operation
        if (abortController.signal.aborted) {
          setConnectionState({
            state: "idle",
            config: null,
            error: null,
          });
          return;
        }

        // Validate vault result
        if (!storeResult.success) {
          throw new Error(
            storeResult.error?.message ||
              "Failed to retrieve API key from vault. Please check your credentials.",
          );
        }

        // Connection successful
        setConnectionState({
          state: "connected",
          config: { provider, model },
          error: null,
        });
      } catch (error) {
        // Check if aborted
        if (abortController.signal.aborted) {
          setConnectionState({
            state: "idle",
            config: null,
            error: null,
          });
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isRetryable = retryCount < MAX_RETRY_ATTEMPTS;

        setConnectionState({
          state: "error",
          config: null,
          error: {
            message: errorMessage,
            retryable: isRetryable,
            retryCount,
          },
        });

        // Auto-retry with exponential backoff if retryable
        if (isRetryable) {
          const delay = calculateRetryDelay(retryCount);
          retryTimeoutRef.current = setTimeout(() => {
            connectRef.current?.(provider, model, vault, retryCount + 1);
          }, delay);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [connectionState.state],
  );

  // Keep connectRef current with latest connect function to avoid stale closures
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /**
   * Manually retry connection (resets retry count).
   */
  const retry = useCallback(
    (provider: string, model: string, vault: UserSecretVaultPort | null) => {
      // Clear any pending auto-retry
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      connectRef.current?.(provider, model, vault, 0);
    },
    [],
  );

  /**
   * Cancel ongoing connection attempt.
   */
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    setConnectionState({
      state: "idle",
      config: null,
      error: null,
    });
  }, []);

  /**
   * Disconnect and reset to idle state.
   */
  const disconnect = useCallback(() => {
    cancel();
    setConnectionState({
      state: "idle",
      config: null,
      error: null,
    });
  }, [cancel]);

  /**
   * Clear error and return to idle state.
   */
  const clearError = useCallback(() => {
    setConnectionState((prev) => ({
      ...prev,
      state: "idle",
      error: null,
    }));
  }, []);

  return {
    state: connectionState.state,
    config: connectionState.config,
    error: connectionState.error,
    connect,
    retry,
    cancel,
    disconnect,
    clearError,
  };
}

// Made with Bob
