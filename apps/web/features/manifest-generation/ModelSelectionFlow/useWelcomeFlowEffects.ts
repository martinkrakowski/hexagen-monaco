"use client";

import { useEffect, type RefObject } from "react";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import { getSecretVault } from "../../../app/lib/wire";
import { useWebGPUDetection } from "./useWebGPUDetection";
import {
  createApiKeyManager,
  type ApiKeyManager,
  getModelPreferences,
  isModelVerified,
  updateModelCacheMetadata,
} from "./modelPreferencesStorage";
import type { WelcomeFlowState } from "./types";
import type { WelcomeFlowErrorCode } from "../WelcomeScreen/WelcomeFlowError";

interface UseWelcomeFlowEffectsOptions {
  flowState: WelcomeFlowState;
  setFlowState: React.Dispatch<React.SetStateAction<WelcomeFlowState>>;
  llmContext: LocalLLMContext;
  hasCheckedCache: RefObject<boolean>;
  preferences: RefObject<ReturnType<typeof getModelPreferences>>;
  setApiKeyManager: React.Dispatch<React.SetStateAction<ApiKeyManager | null>>;
}

export function useWelcomeFlowEffects({
  flowState,
  setFlowState,
  llmContext,
  hasCheckedCache,
  preferences,
  setApiKeyManager,
}: UseWelcomeFlowEffectsOptions) {
  const { engineState, initializeModel, hasAnyCachedModel, hasModelInCache } =
    llmContext;

  const gpuDetection = useWebGPUDetection();

  useEffect(() => {
    createApiKeyManager(getSecretVault()).then((manager) => {
      setApiKeyManager(manager);
    });
  }, [setApiKeyManager]);

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
    setFlowState,
    preferences,
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
  }, [engineState, flowState.state, llmContext, setFlowState]);

  useEffect(() => {
    setFlowState((prev) => ({
      ...prev,
      isModelReady: engineState.status === "ready",
    }));
  }, [engineState.status, setFlowState]);

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
              initializeModel(lastModelId).catch(() => {});
            }
          } else {
            setFlowState((prev) => ({
              ...prev,
              state: "model_downloading",
              generationProgress: 0,
            }));
            initializeModel(lastModelId).catch(() => {});
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
              initializeModel(lastModelId).catch(() => {});
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
    setFlowState,
    hasCheckedCache,
    preferences,
  ]);
}
