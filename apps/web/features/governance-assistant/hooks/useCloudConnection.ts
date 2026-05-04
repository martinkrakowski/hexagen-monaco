"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserSecretVaultPort } from "@hexagen/web-driver";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface ConnectionError {
  message: string;
  retryable: boolean;
  retryCount: number;
}

interface UseCloudConnectionState {
  state: ConnectionState;
  config: { provider: string; model: string } | null;
  error: ConnectionError | null;
}

export function useCloudConnection() {
  const [connectionState, setConnectionState] =
    useState<UseCloudConnectionState>({
      state: "idle",
      config: null,
      error: null,
    });

  const connectionStateRef = useRef(connectionState.state);
  connectionStateRef.current = connectionState.state;

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

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const connect = useCallback(
    async (
      provider: string,
      model: string,
      vault: UserSecretVaultPort | null,
      retryCount = 0,
    ): Promise<void> => {
      if (connectionStateRef.current === "connecting") {
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
        if (!vault) {
          throw new Error(
            "Secret vault not initialized. Please refresh the page and try again.",
          );
        }

        const storeResult = await vault.retrieve();

        if (abortController.signal.aborted) {
          setConnectionState({
            state: "idle",
            config: null,
            error: null,
          });
          return;
        }

        if (!storeResult.success) {
          throw new Error(
            storeResult.error?.message ||
              "Failed to retrieve API key from vault. Please check your credentials.",
          );
        }

        setConnectionState({
          state: "connected",
          config: { provider, model },
          error: null,
        });
      } catch (error) {
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
        const isRetryable = retryCount < 3;

        setConnectionState({
          state: "error",
          config: null,
          error: {
            message: errorMessage,
            retryable: isRetryable,
            retryCount,
          },
        });

        if (isRetryable) {
          const delay = 1000 * Math.pow(2, retryCount);
          retryTimeoutRef.current = setTimeout(() => {
            if (connectRef.current) {
              connectRef.current(provider, model, vault, retryCount + 1);
            }
          }, delay);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const retry = useCallback(
    (provider: string, model: string, vault: UserSecretVaultPort | null) => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (connectRef.current) {
        connectRef.current(provider, model, vault, 0);
      }
    },
    [],
  );

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

  const disconnect = useCallback(() => {
    cancel();
    setConnectionState({
      state: "idle",
      config: null,
      error: null,
    });
  }, [cancel]);

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
