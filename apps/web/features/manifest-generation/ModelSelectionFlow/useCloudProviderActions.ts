"use client";

import { useCallback } from "react";
import type { ApiKeyManager } from "./modelPreferencesStorage";
import type { WelcomeFlowState } from "./types";
import { deriveStateFromEvent } from "./types";
import type { WelcomeFlowErrorCode } from "../WelcomeScreen/WelcomeFlowError";
import {
  validateApiKeyFormat,
  type ModelSelectionEvent,
} from "@hexagen/manifest-generation";

interface UseCloudProviderActionsOptions {
  setFlowState: React.Dispatch<React.SetStateAction<WelcomeFlowState>>;
  apiKeyManager: ApiKeyManager | null;
}

export function useCloudProviderActions({
  setFlowState,
  apiKeyManager,
}: UseCloudProviderActionsOptions) {
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
          const transitionEvent: ModelSelectionEvent = {
            type: "API_KEY_VALID",
          };
          const finalState = deriveStateFromEvent(nextState, transitionEvent);
          setFlowState((prev) => ({ ...prev, state: finalState }));
        } else {
          const transitionEvent: ModelSelectionEvent = {
            type: "API_KEY_INVALID",
          };
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
    [apiKeyManager, validateApiKey, setFlowState],
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

  return {
    selectCloudProvider,
    validateApiKey,
    loadSavedApiKey,
    clearStoredApiKey,
  };
}
