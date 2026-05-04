"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  LocalLLMContext,
  DomainModelId,
} from "../../../lib/llm-interfaces";
import {
  getModelPreferences,
  saveModelPreferences,
  type ApiKeyManager,
} from "./modelPreferencesStorage";
import type { WelcomeFlowErrorCode } from "../WelcomeScreen/WelcomeFlowError";
import { deriveStateFromEvent } from "./types";
import type { WelcomeFlowState, WelcomeFlowActions } from "./types";
import type { WelcomeScreenState } from "./types";

export type { WelcomeFlowState, WelcomeFlowActions, WelcomeScreenState };
export type { DomainModelId };

import { useModelDownloadActions } from "./useModelDownloadActions";
import { useCloudProviderActions } from "./useCloudProviderActions";
import { useWelcomeFlowEffects } from "./useWelcomeFlowEffects";

export function useWelcomeFlowState(
  llmContext: LocalLLMContext,
): [WelcomeFlowState, WelcomeFlowActions] {
  const { initializeModel, cancelDownload } = llmContext;

  const [flowState, setFlowState] = useState<WelcomeFlowState>({
    state: "idle",
    isModelReady: false,
  });

  const [apiKeyManager, setApiKeyManager] = useState<ApiKeyManager | null>(
    null,
  );
  const hasCheckedCache = useRef(false);
  const preferences = useRef(getModelPreferences());
  const downloadIntentRef = useRef(0);

  useWelcomeFlowEffects({
    flowState,
    setFlowState,
    llmContext,
    hasCheckedCache,
    preferences,
    setApiKeyManager,
  });

  const { selectLocalModel, cancelModelDownload, repairModelDownload } =
    useModelDownloadActions({
      setFlowState,
      initializeModel,
      cancelDownload,
      downloadIntentRef,
    });

  const {
    selectCloudProvider,
    validateApiKey,
    loadSavedApiKey,
    clearStoredApiKey,
  } = useCloudProviderActions({
    setFlowState,
    apiKeyManager,
  });

  const transitionTo = useCallback((state: WelcomeScreenState) => {
    setFlowState((prev) => ({ ...prev, state }));
  }, []);

  const skipAiSetup = useCallback(() => {
    saveModelPreferences({ skipAiSetup: true });

    const nextState = deriveStateFromEvent("idle", { type: "SKIP_AI_SETUP" });

    setFlowState((prev) => ({
      ...prev,
      state: nextState,
      aiSetupSkipped: true,
    }));
  }, []);

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
