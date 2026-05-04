"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalLLMContext,
  DomainModelId,
} from "../../../lib/llm-interfaces";
import { getSecretVault } from "../../../app/lib/wire";
import { useWebGPUDetection } from "./useWebGPUDetection";
import {
  getModelPreferences,
  saveModelPreferences,
  createApiKeyManager,
  type ApiKeyManager,
  isModelVerified,
  updateModelCacheMetadata,
  clearModelCacheMetadata,
} from "./modelPreferencesStorage";
import type { WelcomeFlowErrorCode } from "../WelcomeScreen/WelcomeFlowError";

import {
  transitionState,
  type WelcomeScreenState,
  type ModelSelectionEvent,
} from "@hexagen/manifest-generation";
import { validateApiKeyFormat } from "@hexagen/manifest-generation";

export type { WelcomeScreenState };

export interface WelcomeFlowState {
  state: WelcomeScreenState;
  error?: string | null;
  errorCode?: WelcomeFlowErrorCode | null;
  aiSetupSkipped?: boolean;
  selectedModelId?: DomainModelId | null;
  cloudApiKey?: string | null;
  rememberedChoice?: boolean;
  cloudProvider?: "openai" | "anthropic" | "azure" | "other";
  generationProgress?: number;
  manifestContent?: string;
  lastRejectedManifest?: string | null;
  isModelReady?: boolean;
  clarificationTriggers?: Array<{
    type: string;
    contextName?: string;
    message: string;
  }> | null;
  hardwareCapabilities?: {
    isWebGPUSupported: boolean;
    isBrowserSupported: boolean;
    isHardwareAdequate: boolean;
    estimatedVRAM: number | null;
    isRecommended: boolean;
  } | null;
}

export interface WelcomeFlowActions {
  transitionTo: (state: WelcomeScreenState) => void;
  selectLocalModel: (modelId: DomainModelId, remember: boolean) => void;
  selectCloudProvider: (
    provider: string,
    apiKey: string,
    remember: boolean,
  ) => void;
  skipAiSetup: () => void;
  cancelModelDownload: () => void;
  setError: (message: string, errorCode?: WelcomeFlowErrorCode) => void;
  clearError: () => void;
  retryGeneration: () => void;
  saveGenerationResult: (manifest: string) => void;
  restartFromSelection: () => void;
  proceedToWizard: () => void;
  clearStoredApiKey: () => Promise<void>;
  validateApiKey: (provider: string, key: string) => Promise<boolean>;
  loadSavedApiKey: (provider: string) => Promise<string | null>;
  rejectManifest: () => void;
  regenerateManifest: () => void;
  repairModelDownload: (modelId: DomainModelId) => void;
  setClarificationNeeded: (
    triggers: Array<{
      type: string;
      contextName?: string;
      message: string;
    }>,
  ) => void;
  confirmAndContinue: () => void;
}

function deriveStateFromEvent(
  currentState: WelcomeScreenState,
  event: ModelSelectionEvent,
): WelcomeScreenState {
  return transitionState(currentState, event);
}

export function useWelcomeFlowState(
  llmContext: LocalLLMContext,
): [WelcomeFlowState, WelcomeFlowActions] {
  const {
    engineState,
    initializeModel,
    cancelDownload,
    hasAnyCachedModel,
    hasModelInCache,
  } = llmContext;

  const [flowState, setFlowState] = useState<WelcomeFlowState>({
    state: "idle",
    isModelReady: false,
  });

  const [apiKeyManager, setApiKeyManager] = useState<ApiKeyManager | null>(
    null,
  );
  const gpuDetection = useWebGPUDetection();
  const hasCheckedCache = useRef(false);
  const preferences = useRef(getModelPreferences());
  const downloadIntentRef = useRef(0);

  useEffect(() => {
    createApiKeyManager(getSecretVault()).then((manager) => {
      setApiKeyManager(manager);
    });
  }, []);

  useEffect(() => {
    if (!gpuDetection.isLoading) {
      setFlowState((prev) => ({
        ...prev,
        hardwareCapabilities: {
          isWebGPUSupported: gpuDetection.isWebGPUSupported,
          isBrowserSupported: gpuDetection.isBrowserSupported,
          isHardwareAdequate: gpuDetection.isHardwareAdequate,
          estimatedVRAM: gpuDetection.estimatedVRAM,
          isRecommended: gpuDetection.isRecommended,
        },
      }));

      if (!gpuDetection.isWebGPUSupported && !gpuDetection.isLoading) {
        // GPU not supported - user will need cloud LLM
      }
    }

    preferences.current = getModelPreferences();

    if (preferences.current.skipAiSetup) {
      setFlowState((prev) => ({ ...prev, aiSetupSkipped: true }));
    }
  }, [
    gpuDetection.isLoading,
    gpuDetection.isWebGPUSupported,
    gpuDetection.isBrowserSupported,
    gpuDetection.isHardwareAdequate,
    gpuDetection.estimatedVRAM,
    gpuDetection.isRecommended,
  ]);

  useEffect(() => {
    if (flowState.state !== "model_downloading") return;

    if (engineState.progress !== undefined) {
      setFlowState((prev) => ({
        ...prev,
        generationProgress: engineState.progress,
      }));
    }

    if (engineState.status === "ready") {
      const runSmokeTest = async () => {
        const modelId = flowState.selectedModelId;
        if (!modelId) return;

        if (isModelVerified(modelId)) {
          setFlowState((prev) => ({
            ...prev,
            state: "generating",
            isModelReady: true,
          }));
          return;
        }

        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Smoke test timed out")), 5000);
          });

          await Promise.race([
            llmContext.sendGovernanceMessage(
              "Respond with 'OK'",
              "You are a test helper. Reply only with the word OK.",
            ),
            timeoutPromise,
          ]);

          updateModelCacheMetadata(modelId, {
            verifiedAt: Date.now(),
            downloadCompleted: true,
          });

          setFlowState((prev) => ({
            ...prev,
            state: "generating",
            isModelReady: true,
          }));
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          const isSmokeTestTimeout = errorMessage.includes("timed out");

          setFlowState((prev) => ({
            ...prev,
            state: "error",
            error: isSmokeTestTimeout
              ? "The model failed to respond in time. It may be corrupted or too slow for this device."
              : "The model cache appears to be corrupted. You can repair the download.",
            errorCode: "model_corrupted" as WelcomeFlowErrorCode,
            isModelReady: false,
          }));

          updateModelCacheMetadata(modelId, { downloadCompleted: false });
        }
      };
      runSmokeTest();
    } else if (engineState.status === "error") {
      setFlowState((prev) => ({
        ...prev,
        state: "error",
        error: engineState.errorMessage || "Failed to initialize model",
        errorCode: "network_failure" as WelcomeFlowErrorCode,
        isModelReady: false,
      }));
    }
  }, [engineState, flowState.state, llmContext]);

  useEffect(() => {
    setFlowState((prev) => ({
      ...prev,
      isModelReady: engineState.status === "ready",
    }));
  }, [engineState.status]);

  useEffect(() => {
    if (!hasCheckedCache.current) {
      hasCheckedCache.current = true;

      const lastModelId = preferences.current.lastModelId;

      if (preferences.current.rememberChoice && lastModelId) {
        setFlowState((prev) => ({
          ...prev,
          selectedModelId: lastModelId,
        }));

        hasModelInCache(lastModelId).then((isInCache) => {
          if (isInCache) {
            setFlowState((prev) => ({
              ...prev,
              state: "generating",
              isModelReady: true,
            }));
            if (engineState.status !== "ready") {
              initializeModel(lastModelId).catch(() => {
              });
            }
          } else {
            setFlowState((prev) => ({
              ...prev,
              state: "model_downloading",
              generationProgress: 0,
            }));
            initializeModel(lastModelId).catch(() => {
            });
          }
        });
        return;
      }

      if (lastModelId) {
        hasModelInCache(lastModelId).then((isInCache) => {
          if (isInCache) {
            setFlowState((prev) => ({
              ...prev,
              selectedModelId: lastModelId,
            }));

            if (
              preferences.current.autoLoadEnabled &&
              engineState.status !== "ready"
            ) {
              initializeModel(lastModelId).catch(() => {
              });
            }
          }
        });
      } else {
        hasAnyCachedModel().then((hasCached) => {
          if (hasCached && engineState.status === "ready") {
            setFlowState((prev) => ({
              ...prev,
              selectedModelId: engineState.loadedModelId,
            }));
          }
        });
      }
    }
  }, [
    engineState.loadedModelId,
    engineState.status,
    hasAnyCachedModel,
    hasModelInCache,
    initializeModel,
  ]);

  const transitionTo = useCallback((state: WelcomeScreenState) => {
    setFlowState((prev) => ({ ...prev, state }));
  }, []);

  const selectLocalModel = useCallback(
    (modelId: DomainModelId, remember: boolean) => {
      const intentId = ++downloadIntentRef.current;
      const nextState = deriveStateFromEvent("model_selection", {
        type: "SELECT_LOCAL_MODEL",
        modelId,
        remember,
      });

      setFlowState((prev) => ({
        ...prev,
        state: nextState,
        selectedModelId: modelId,
        rememberedChoice: remember,
        generationProgress: 0,
      }));

      if (remember) {
        saveModelPreferences({
          lastModelId: modelId,
          autoLoadEnabled: true,
          hasEnabledLocalModels: true,
          rememberChoice: true,
        });
      }

      initializeModel(modelId).catch((error) => {
        if (intentId !== downloadIntentRef.current) return;
        setFlowState((prev) => ({
          ...prev,
          state: "error",
          error: error?.message || "Failed to initialize model",
        }));

        if (remember) {
          saveModelPreferences({ autoLoadEnabled: false });
        }
      });
    },
    [initializeModel],
  );

  const validateApiKey = useCallback(
    async (provider: string, key: string): Promise<boolean> => {
      if (!validateApiKeyFormat(provider, key)) {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    },
    [],
  );

  const selectCloudProvider = useCallback(
    async (provider: string, apiKey: string, remember: boolean) => {
      const nextState = deriveStateFromEvent("model_selection", {
        type: "SELECT_CLOUD_PROVIDER",
        provider,
        apiKey,
        remember,
      });

      setFlowState((prev) => ({
        ...prev,
        state: nextState,
        cloudProvider: provider as "openai" | "anthropic" | "azure" | "other",
        cloudApiKey: apiKey,
        rememberedChoice: remember,
      }));

      try {
        if (apiKeyManager && remember) {
          await apiKeyManager.saveApiKey(provider, apiKey, remember);
        }

        const isValid = await validateApiKey(provider, apiKey);

        if (isValid) {
          const transitionEvent: ModelSelectionEvent = { type: "API_KEY_VALID" };
          const finalState = deriveStateFromEvent(nextState, transitionEvent);
          setFlowState((prev) => ({ ...prev, state: finalState }));
        } else {
          const transitionEvent: ModelSelectionEvent = { type: "API_KEY_INVALID" };
          const errorState = deriveStateFromEvent(nextState, transitionEvent);
          setFlowState((prev) => ({
            ...prev,
            state: errorState,
            error:
              "The API key format appears invalid. Please check your key and try again.",
            errorCode: "key_invalid_format" as WelcomeFlowErrorCode,
          }));
        }
      } catch (error) {
        setFlowState((prev) => ({
          ...prev,
          state: "error",
          error:
            error instanceof Error
              ? error.message
              : "An error occurred validating your API key",
          errorCode: "key_rejected" as WelcomeFlowErrorCode,
        }));
      }
    },
    [apiKeyManager, validateApiKey],
  );

  const loadSavedApiKey = useCallback(
    async (provider: string): Promise<string | null> => {
      if (!apiKeyManager) return null;
      return apiKeyManager.getApiKey(provider);
    },
    [apiKeyManager],
  );

  const clearStoredApiKey = useCallback(async (): Promise<void> => {
    if (!apiKeyManager) return;
    await apiKeyManager.clearApiKeys();
  }, [apiKeyManager]);

  const skipAiSetup = useCallback(() => {
    saveModelPreferences({ skipAiSetup: true });

    const nextState = deriveStateFromEvent("idle", { type: "SKIP_AI_SETUP" });

    setFlowState((prev) => ({
      ...prev,
      state: nextState,
      aiSetupSkipped: true,
    }));
  }, []);

  const cancelModelDownload = useCallback(() => {
    cancelDownload();

    ++downloadIntentRef.current;

    saveModelPreferences({ autoLoadEnabled: false, rememberChoice: false });

    const nextState = deriveStateFromEvent("model_downloading", {
      type: "CANCEL_DOWNLOAD",
    });

    setFlowState((prev) => ({
      ...prev,
      state: nextState,
      isModelReady: false,
    }));
  }, [cancelDownload]);

  const setError = useCallback(
    (message: string, errorCode?: WelcomeFlowErrorCode) => {
      setFlowState((prev) => ({
        ...prev,
        state: "error",
        error: message,
        errorCode: errorCode ?? null,
      }));
    },
    [],
  );

  const clearError = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      error: null,
      state: "idle",
    }));
  }, []);

  const retryGeneration = useCallback(() => {
    if (flowState.selectedModelId) {
      setFlowState((prev) => ({ ...prev, state: "generating", error: null }));
    } else if (flowState.cloudApiKey) {
      setFlowState((prev) => ({ ...prev, state: "generating", error: null }));
    } else {
      setFlowState((prev) => ({ ...prev, state: "idle", error: null }));
    }
  }, [flowState.cloudApiKey, flowState.selectedModelId]);

  const saveGenerationResult = useCallback((manifestContent: string) => {
    setFlowState((prev) => ({
      ...prev,
      state: "preview",
      manifestContent,
    }));
  }, []);

  const rejectManifest = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      lastRejectedManifest: prev.manifestContent ?? null,
      state: "model_selection",
      manifestContent: undefined,
      error: null,
    }));
  }, []);

  const regenerateManifest = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      state: "generating",
      manifestContent: undefined,
      error: null,
    }));
  }, []);

  const restartFromSelection = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      state: "model_selection",
      error: null,
    }));
  }, []);

  const proceedToWizard = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      state: "wizard_hydration",
    }));
  }, []);

  const repairModelDownload = useCallback(
    (modelId: DomainModelId) => {
      clearModelCacheMetadata(modelId);

      const intentId = ++downloadIntentRef.current;
      const nextState = deriveStateFromEvent("error", {
        type: "REPAIR_MODEL_DOWNLOAD",
        modelId,
      });

      setFlowState((prev) => ({
        ...prev,
        state: nextState,
        selectedModelId: modelId,
        generationProgress: 0,
        error: null,
      }));

      initializeModel(modelId).catch((error) => {
        if (intentId !== downloadIntentRef.current) return;
        setFlowState((prev) => ({
          ...prev,
          state: "error",
          error: error?.message || "Failed to repair model",
        }));
      });
    },
    [initializeModel],
  );

  const setClarificationNeeded = useCallback(
    (
      triggers: Array<{ type: string; contextName?: string; message: string }>,
    ) => {
      setFlowState((prev) => ({
        ...prev,
        state: "clarification_needed",
        clarificationTriggers: triggers,
      }));
    },
    [],
  );

  const confirmAndContinue = useCallback(() => {
    setFlowState((prev) => ({
      ...prev,
      state: "generating",
      clarificationTriggers: null,
    }));
  }, []);

  const actions: WelcomeFlowActions = useMemo(
    () => ({
      transitionTo,
      selectLocalModel,
      selectCloudProvider,
      skipAiSetup,
      cancelModelDownload,
      setError,
      clearError,
      retryGeneration,
      saveGenerationResult,
      restartFromSelection,
      proceedToWizard,
      clearStoredApiKey,
      validateApiKey,
      loadSavedApiKey,
      rejectManifest,
      regenerateManifest,
      repairModelDownload,
      setClarificationNeeded,
      confirmAndContinue,
    }),
    [
      transitionTo,
      selectLocalModel,
      selectCloudProvider,
      skipAiSetup,
      cancelModelDownload,
      setError,
      clearError,
      retryGeneration,
      saveGenerationResult,
      restartFromSelection,
      proceedToWizard,
      clearStoredApiKey,
      validateApiKey,
      loadSavedApiKey,
      rejectManifest,
      regenerateManifest,
      repairModelDownload,
      setClarificationNeeded,
      confirmAndContinue,
    ],
  );

  return [flowState, actions];
}

export type { DomainModelId };