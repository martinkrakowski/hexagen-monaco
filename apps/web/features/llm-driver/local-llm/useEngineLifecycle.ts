"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DomainModelId,
  LLMEngineState,
  LLMProgress,
  ModelLifecyclePort,
  ModelMetadata,
  SendStructuredRequestPort,
  WebGPUDetectorPort,
} from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

import { getModelLifecycle, getWebGPUDetector } from "@/lib/wire";

import { AUTO_LOAD_KEY, HAS_ENABLED_KEY, LAST_MODEL_KEY } from "./storage-keys";
import {
  deriveStatus,
  isNetworkFetchProgress,
  progressToStatus,
} from "./engine-status";

interface UseEngineLifecycleOptions {
  /**
   * Called before destructive transitions (switchModel,
   * deleteCachedModel of the loaded model). Lets the parent wire
   * chat-message clearing without exposing the adapter ref.
   */
  onMessagesClear: () => void;
}

export interface UseEngineLifecycleReturn {
  engineState: LLMEngineState;
  loadedModel: ModelMetadata | null;
  /** Exposes the adapter for hooks that need it (chat, cache). */
  adapterRef: React.MutableRefObject<
    (ModelLifecyclePort & SendStructuredRequestPort) | null
  >;

  initializeModel: (modelId?: DomainModelId) => Promise<void>;
  switchModel: (modelId: DomainModelId) => Promise<void>;
  deleteCachedModel: (modelId: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  clearError: () => void;
  enterRequiresModel: () => void;
  returnToModelSettings: () => void;

  /**
   * Narrow setter exposed for useAutoInitLastModel only. Do not use
   * from consumers; they should drive transitions via the public
   * action methods above.
   */
  setEngineStateForAutoInit: React.Dispatch<
    React.SetStateAction<LLMEngineState>
  >;
}

/**
 * Owns the local LLM engine state machine and the adapter lifecycle.
 * Covers: WebGPU detection on mount, model initialization with
 * cancellable progress, model switching, cached-model deletion, and
 * reset transitions (cancel, clear-error, return-to-settings).
 *
 * The adapterRef is exposed so sibling hooks (useChatMessages,
 * useModelCache) can call adapter methods directly. This is a
 * controlled leak — the ref is only read by other hooks in this
 * local-llm/ module, never by components.
 */
export function useEngineLifecycle(
  options: UseEngineLifecycleOptions,
): UseEngineLifecycleReturn {
  const { onMessagesClear } = options;

  const adapterRef = useRef<
    (ModelLifecyclePort & SendStructuredRequestPort) | null
  >(null);
  const webgpuRef = useRef<WebGPUDetectorPort | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isInitializingRef = useRef(false);
  const cancelInitRef = useRef<(() => void) | null>(null);

  const [engineState, setEngineState] = useState<LLMEngineState>(
    LLM_ENGINE_INITIAL_STATE,
  );

  const loadedModel =
    engineState.status === "ready" || engineState.status === "loading_vram"
      ? (adapterRef.current?.getLoadedModel() ?? null)
      : null;

  // Effect: wire adapters + run WebGPU detection on mount.
  useEffect(() => {
    // Migration: users from before HAS_ENABLED_KEY was introduced
    // only have AUTO_LOAD_KEY. Backfill HAS_ENABLED_KEY so the
    // opted-in hold logic works for existing users.
    if (
      localStorage.getItem(AUTO_LOAD_KEY) === "true" &&
      localStorage.getItem(HAS_ENABLED_KEY) === null
    ) {
      localStorage.setItem(HAS_ENABLED_KEY, "true");
    }

    adapterRef.current = getModelLifecycle() as ModelLifecyclePort &
      SendStructuredRequestPort;
    webgpuRef.current = getWebGPUDetector();

    if (adapterRef.current && webgpuRef.current) {
      const DETECT_TIMEOUT_MS = 10_000;

      const detectWithTimeout = Promise.race([
        webgpuRef.current.detect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("webgpu-detect-timeout")),
            DETECT_TIMEOUT_MS,
          ),
        ),
      ]);

      detectWithTimeout
        .then((result: Result<{ supported: boolean }>) => {
          const webgpuSupported =
            result.success && (result.value?.supported ?? false);
          const browserSupported = typeof OffscreenCanvas !== "undefined";
          const status = deriveStatus(null, webgpuSupported, browserSupported);
          setEngineState((prev) => ({ ...prev, status }));
        })
        .catch(() => {
          setEngineState((prev) => ({
            ...prev,
            status: "unsupported_browser",
          }));
        });
    } else {
      setEngineState((prev) => ({ ...prev, status: "unavailable" }));
    }

    return () => {
      abortControllerRef.current?.abort();
      adapterRef.current?.dispose();
    };
  }, []);

  const initializeModel = useCallback(
    async (modelId?: DomainModelId) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (isInitializingRef.current) return;
      if (engineState.status === "ready" && adapter.getLoadedModel() !== null)
        return;

      const { DEFAULT_MODEL_ID } = await import("@hexagen/local-llm");
      const targetModelId = modelId ?? DEFAULT_MODEL_ID;
      isInitializingRef.current = true;
      setEngineState((prev) => ({
        ...prev,
        status: "downloading",
        progress: 0,
      }));

      const cancelPromise = new Promise<Result<void>>((_, reject) => {
        cancelInitRef.current = () => reject(new Error("download-cancelled"));
      });

      let initResult: Result<void>;
      try {
        initResult = await Promise.race([
          adapter.initialize(
            { modelId: targetModelId },
            (progress: LLMProgress) => {
              const isNetworkFetch = isNetworkFetchProgress(
                progress.text || "",
              );
              setEngineState((prev) => ({
                ...prev,
                status: progressToStatus(progress.phase),
                progress: progress.progress,
                // Only clear autoLoading when an actual network download
                // is underway — warm cache hits must not clear it.
                autoLoading: prev.autoLoading && !isNetworkFetch,
              }));
            },
          ),
          cancelPromise,
        ]);
      } catch {
        // Cancelled. Always clear AUTO_LOAD_KEY and LAST_MODEL_KEY so
        // a subsequent page reload does not attempt a silent background
        // download. HAS_ENABLED_KEY is preserved if set, keeping the
        // user in "requires_model" instead of dropping them back to the
        // first-time OptIn screen.
        const hasPreviouslyEnabled =
          localStorage.getItem(HAS_ENABLED_KEY) !== null;
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        adapter.dispose();
        cancelInitRef.current = null;
        isInitializingRef.current = false;
        setEngineState((prev) => ({
          ...prev,
          status: hasPreviouslyEnabled ? "requires_model" : "opt_in",
          progress: 0,
          errorMessage: null,
          autoLoading: false,
        }));
        return;
      }

      cancelInitRef.current = null;

      if (!initResult.success) {
        // On error clear both flags — prevents an auto-fail loop on next mount.
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        setEngineState((prev) => ({
          ...prev,
          status: "error",
          autoLoading: false,
          errorMessage:
            initResult.error instanceof Error
              ? initResult.error.message
              : String(initResult.error),
        }));
      } else {
        localStorage.setItem(AUTO_LOAD_KEY, "true");
        localStorage.setItem(LAST_MODEL_KEY, targetModelId);
        // Only set HAS_ENABLED_KEY on first successful enable.
        if (localStorage.getItem(HAS_ENABLED_KEY) !== "true") {
          localStorage.setItem(HAS_ENABLED_KEY, "true");
        }
        setEngineState((prev) => ({
          ...prev,
          status: "ready",
          progress: 1,
          autoLoading: false,
          loadedModelId: adapter.getLoadedModel()?.modelId ?? null,
        }));
      }
      isInitializingRef.current = false;
    },
    [engineState.status],
  );

  const cancelDownload = useCallback(() => {
    // Always clear both flags on a manual cancel. HAS_ENABLED_KEY is
    // sufficient to remember the user has previously opted in.
    localStorage.removeItem(AUTO_LOAD_KEY);
    localStorage.removeItem(LAST_MODEL_KEY);
    if (cancelInitRef.current) {
      cancelInitRef.current();
      cancelInitRef.current = null;
    }
  }, []);

  const enterRequiresModel = useCallback(() => {
    setEngineState((prev) => ({ ...prev, status: "requires_model" }));
  }, []);

  const clearError = useCallback(() => {
    setEngineState((prev) => ({ ...prev, errorMessage: null }));
  }, []);

  const returnToModelSettings = useCallback(() => {
    const hasPreviouslyEnabled = localStorage.getItem(HAS_ENABLED_KEY) !== null;
    if (isInitializingRef.current || cancelInitRef.current) {
      cancelDownload();
      return;
    }
    setEngineState((prev) => ({
      ...prev,
      status: hasPreviouslyEnabled ? "requires_model" : "opt_in",
      errorMessage: null,
      progress: 0,
      autoLoading: false,
    }));
  }, [cancelDownload]);

  const switchModel = useCallback(
    async (modelId: DomainModelId) => {
      if (modelId === engineState.loadedModelId) return;

      const adapter = adapterRef.current;
      if (isInitializingRef.current) {
        cancelInitRef.current?.();
        cancelInitRef.current = null;
        isInitializingRef.current = false;
      }
      adapter?.dispose();

      localStorage.removeItem(AUTO_LOAD_KEY);
      localStorage.removeItem(LAST_MODEL_KEY);
      onMessagesClear();
      setEngineState((prev) => ({
        ...prev,
        status: "opt_in",
        loadedModelId: null,
        errorMessage: null,
        autoLoading: false,
      }));

      await initializeModel(modelId);
    },
    [engineState.loadedModelId, initializeModel, onMessagesClear],
  );

  const deleteCachedModel = useCallback(
    async (modelId: DomainModelId) => {
      const adapter = adapterRef.current;
      if (!adapter) return;

      // If deleting the currently-loaded model, cascade the engine
      // state transition and clear messages.
      if (modelId === engineState.loadedModelId) {
        adapter.dispose();
        onMessagesClear();
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        setEngineState((prev) => ({
          ...prev,
          status: "requires_model",
          loadedModelId: null,
          errorMessage: null,
          autoLoading: false,
        }));
      }

      const result = await adapter.deleteCachedModel(modelId);
      if (!result.success) {
        throw result.error;
      }
    },
    [engineState.loadedModelId, onMessagesClear],
  );

  return {
    engineState,
    loadedModel,
    adapterRef,
    initializeModel,
    switchModel,
    deleteCachedModel,
    cancelDownload,
    clearError,
    enterRequiresModel,
    returnToModelSettings,
    setEngineStateForAutoInit: setEngineState,
  };
}
