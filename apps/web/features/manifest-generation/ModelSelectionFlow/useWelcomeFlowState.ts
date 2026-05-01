"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { WelcomeFlowErrorCode } from "./WelcomeFlowError";

/**
 * State machine for the welcome modal flow
 */
export type WelcomeScreenState =
  | "idle" // Initial state, showing description field
  | "model_selection" // User choosing local/cloud
  | "model_downloading" // Local model downloading
  | "key_validation" // Cloud API key validating
  | "generating" // Manifest being generated
  | "preview" // Showing generated manifest
  | "error" // Error state with retry options
  | "interrupted" // User cancelled download
  | "unsupported" // Device doesn't support WebGPU
  | "wizard_hydration"; // Transitioning to project wizard

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
}

/**
 * State machine hook for the welcome flow.
 * Manages transitions and integrates with the LLM context.
 */
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

  // Initialize the API key manager
  useEffect(() => {
    createApiKeyManager(getSecretVault()).then((manager) => {
      setApiKeyManager(manager);
    });
  }, []);

  // Initialize hardware capabilities detection and load preferences
  useEffect(() => {
    // Check hardware capabilities
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

      // If WebGPU is not supported, transition to unsupported state
      if (!gpuDetection.isWebGPUSupported && !gpuDetection.isLoading) {
        setFlowState((prev) => ({
          ...prev,
          state: prev.state === "idle" ? "unsupported" : prev.state,
          errorCode:
            prev.state === "idle"
              ? ("webgpu_unavailable" as WelcomeFlowErrorCode)
              : prev.errorCode,
        }));
      }
    }

    // Load model preferences
    preferences.current = getModelPreferences();

    // If AI setup was previously skipped, reflect that in state
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

  // When engineState changes, reflect it in our flow state
  useEffect(() => {
    if (flowState.state !== "model_downloading") return;

    // Update progress
    if (engineState.progress !== undefined) {
      setFlowState((prev) => ({
        ...prev,
        generationProgress: engineState.progress,
      }));
    }

    // Transition based on engine state changes
    if (engineState.status === "ready") {
      // Phase 13: Smoke test before transitioning
      const runSmokeTest = async () => {
        const modelId = flowState.selectedModelId;
        if (!modelId) return;

        // Skip smoke test if model was recently verified
        if (isModelVerified(modelId)) {
          setFlowState((prev) => ({
            ...prev,
            state: "generating",
            isModelReady: true,
          }));
          return;
        }

        try {
          // Create a timeout promise
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Smoke test timed out")), 5000);
          });

          // Run the smoke test with timeout
          await Promise.race([
            llmContext.sendGovernanceMessage(
              "Respond with 'OK'",
              "You are a test helper. Reply only with the word OK.",
            ),
            timeoutPromise,
          ]);

          // Update model cache metadata with successful verification
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

          // Mark the download as incomplete
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

  // Sync isModelReady with engine status
  useEffect(() => {
    setFlowState((prev) => ({
      ...prev,
      isModelReady: engineState.status === "ready",
    }));
  }, [engineState.status]);

  // Check for cached models on first render
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
                // Silent failure for auto-load attempt
              });
            }
          } else {
            setFlowState((prev) => ({
              ...prev,
              state: "model_downloading",
              generationProgress: 0,
            }));
            initializeModel(lastModelId).catch(() => {
              // Silent failure for auto-download attempt
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

            // Auto-load if enabled in preferences
            if (
              preferences.current.autoLoadEnabled &&
              engineState.status !== "ready"
            ) {
              initializeModel(lastModelId).catch(() => {
                // Silent failure for auto-load attempt
              });
            }
          }
        });
      } else {
        // Check if any model is cached
        hasAnyCachedModel().then((hasCached) => {
          if (hasCached && engineState.status === "ready") {
            // If we have a model cached and it's ready, use it
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
      setFlowState((prev) => ({
        ...prev,
        state: "model_downloading",
        selectedModelId: modelId,
        rememberedChoice: remember,
        generationProgress: 0,
      }));

      // Save preferences if remembering this choice
      if (remember) {
        saveModelPreferences({
          lastModelId: modelId,
          autoLoadEnabled: true,
          hasEnabledLocalModels: true,
          rememberChoice: true,
        });
      }

      // Initialize the model
      initializeModel(modelId).catch((error) => {
        if (intentId !== downloadIntentRef.current) return;
        setFlowState((prev) => ({
          ...prev,
          state: "error",
          error: error?.message || "Failed to initialize model",
        }));

        // Clear auto-load on error
        if (remember) {
          saveModelPreferences({ autoLoadEnabled: false });
        }
      });
    },
    [initializeModel],
  );

  const validateApiKey = useCallback(
    async (provider: string, key: string): Promise<boolean> => {
      // In a real implementation, this would validate the key with the provider's API
      // For now, we'll simulate validation with basic checks
      if (!key || key.length < 8) {
        return false;
      }

      // Different validation rules per provider
      if (provider === "openai" && !key.startsWith("sk-")) {
        return false;
      }

      if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
        return false;
      }

      // Simulate API validation delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    },
    [],
  );

  const selectCloudProvider = useCallback(
    async (provider: string, apiKey: string, remember: boolean) => {
      setFlowState((prev) => ({
        ...prev,
        state: "key_validation",
        cloudProvider: provider as "openai" | "anthropic" | "azure" | "other",
        cloudApiKey: apiKey,
        rememberedChoice: remember,
      }));

      try {
        // Save the API key if remember is true
        if (apiKeyManager && remember) {
          await apiKeyManager.saveApiKey(provider, apiKey, remember);
        }

        // Validate the API key
        const isValid = await validateApiKey(provider, apiKey);

        if (isValid) {
          setFlowState((prev) => ({ ...prev, state: "generating" }));
        } else {
          setFlowState((prev) => ({
            ...prev,
            state: "error",
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
    // Save preference
    saveModelPreferences({ skipAiSetup: true });

    setFlowState((prev) => ({
      ...prev,
      state: "idle",
      aiSetupSkipped: true,
    }));
  }, []);

  const cancelModelDownload = useCallback(() => {
    // Cancel download via LocalLLM context
    cancelDownload();

    // Invalidate the download intent so stale completions are ignored
    ++downloadIntentRef.current;

    // Clear auto-load and remember choice preferences
    saveModelPreferences({ autoLoadEnabled: false, rememberChoice: false });

    setFlowState((prev) => ({
      ...prev,
      state: "interrupted",
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
    // Determine which state to return to based on the error context
    if (flowState.selectedModelId) {
      setFlowState((prev) => ({ ...prev, state: "model_selection" }));
    } else if (flowState.cloudApiKey) {
      setFlowState((prev) => ({ ...prev, state: "key_validation" }));
    } else {
      setFlowState((prev) => ({ ...prev, state: "idle" }));
    }
  }, [flowState.cloudApiKey, flowState.selectedModelId]);

  const saveGenerationResult = useCallback((manifestContent: string) => {
    // Store the generation result (implementation would depend on app requirements)
    // For now, just transition to preview state
    setFlowState((prev) => ({
      ...prev,
      state: "preview",
      // Store the manifest content in the state so it can be used in the UI
      manifestContent,
    }));

    // Here you would store the manifest content in app state or backend
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
      // Preserve description context: description lives in WelcomeScreen
      // component state and won't be cleared by this action
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

    // This would typically trigger some app-level event or routing
  }, []);

  const repairModelDownload = useCallback(
    (modelId: DomainModelId) => {
      // Clear cache metadata for this model
      clearModelCacheMetadata(modelId);

      // Restart download with the same model
      const intentId = ++downloadIntentRef.current;
      setFlowState((prev) => ({
        ...prev,
        state: "model_downloading",
        selectedModelId: modelId,
        generationProgress: 0,
        error: null,
      }));

      // Initialize the model (will force re-download)
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

  const actions: WelcomeFlowActions = {
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
  };

  return [flowState, actions];
}

// Export common types and utilities
export type { DomainModelId };
