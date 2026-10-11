"use client";

import { useCallback, type RefObject } from "react";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import {
  saveModelPreferences,
  clearModelCacheMetadata,
} from "./modelPreferencesStorage";
import type { ModelSelectionFlowState } from "./types";
import { deriveStateFromEvent } from "./types";
import { GENERATE_WITH_AI_ERROR_MESSAGES } from "../GenerateWithAi/GenerateWithAiError";

interface UseModelDownloadActionsOptions {
  setFlowState: React.Dispatch<React.SetStateAction<ModelSelectionFlowState>>;
  initializeModel: (modelId: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  downloadIntentRef: RefObject<number>;
  isWebGPUSupported: boolean | undefined;
}

export function useModelDownloadActions({
  setFlowState,
  initializeModel,
  cancelDownload,
  downloadIntentRef,
  isWebGPUSupported,
}: UseModelDownloadActionsOptions) {
  const selectLocalModel = useCallback(
    (modelId: DomainModelId, remember: boolean) => {
      if (isWebGPUSupported === false) {
        setFlowState((prev) => ({
          ...prev,
          state: deriveStateFromEvent(prev.state, {
            type: "WEBGPU_UNAVAILABLE",
          }),
          errorCode: "webgpu_unavailable",
          error: GENERATE_WITH_AI_ERROR_MESSAGES.webgpu_unavailable,
        }));
        return;
      }
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
    [initializeModel, setFlowState, downloadIntentRef, isWebGPUSupported],
  );

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
  }, [cancelDownload, setFlowState]);

  const repairModelDownload = useCallback(
    (modelId: DomainModelId) => {
      if (isWebGPUSupported === false) {
        setFlowState((prev) => ({
          ...prev,
          state: deriveStateFromEvent(prev.state, {
            type: "WEBGPU_UNAVAILABLE",
          }),
          errorCode: "webgpu_unavailable",
          error: GENERATE_WITH_AI_ERROR_MESSAGES.webgpu_unavailable,
        }));
        return;
      }
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
    [initializeModel, setFlowState, downloadIntentRef, isWebGPUSupported],
  );

  return { selectLocalModel, cancelModelDownload, repairModelDownload };
}
