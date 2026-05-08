import type { DomainModelId } from "@hexagen/local-llm/shared";
import type { GenerateWithAiScreenState } from "../../domain/services/model-selection-state-machine";
import type { ModelPreferencesPort } from "../ports/out/model-preferences.port";
import type { ModelVerificationPort } from "../ports/out/model-verification.port";
import { validateApiKeyFormat } from "../../domain/services/api-key-validation-service";

export interface ModelDownloadOrchestratorDeps {
  preferencesPort: ModelPreferencesPort;
  verificationPort: ModelVerificationPort;
}

export interface ModelDownloadCommand {
  modelId: DomainModelId;
  remember: boolean;
}

export interface CloudProviderCommand {
  provider: string;
  apiKey: string;
  remember: boolean;
}

export interface OrchestratorResult {
  success: boolean;
  nextState: GenerateWithAiScreenState;
  error?: string;
  errorCode?: string;
}

export function createModelDownloadOrchestrator(
  deps: ModelDownloadOrchestratorDeps,
) {
  const { preferencesPort, verificationPort } = deps;

  return {
    selectLocalModel(command: ModelDownloadCommand): OrchestratorResult {
      const { modelId, remember } = command;

      if (remember) {
        preferencesPort.setPreferences({
          lastModelId: modelId,
          autoLoadEnabled: true,
          hasEnabledLocalModels: true,
          rememberChoice: true,
        });
      }

      return { success: true, nextState: "model_downloading" };
    },

    cancelDownload(): OrchestratorResult {
      preferencesPort.setPreferences({
        autoLoadEnabled: false,
        rememberChoice: false,
      });

      return { success: true, nextState: "interrupted" };
    },

    repairModelDownload(modelId: DomainModelId): OrchestratorResult {
      verificationPort.clearModelCacheMetadata(modelId);
      return { success: true, nextState: "model_downloading" };
    },

    markModelReady(modelId: DomainModelId): OrchestratorResult {
      verificationPort.updateModelCacheMetadata(modelId, {
        verifiedAt: Date.now(),
        downloadCompleted: true,
      });

      return { success: true, nextState: "generating" };
    },

    selectCloudProvider(command: CloudProviderCommand): OrchestratorResult {
      const { provider, apiKey, remember } = command;

      if (!validateApiKeyFormat(provider, apiKey)) {
        return {
          success: false,
          nextState: "error",
          error:
            "The API key format appears invalid. Please check your key and try again.",
          errorCode: "key_invalid_format",
        };
      }

      if (remember) {
        preferencesPort.setPreferences({
          cloudProvider: provider,
          rememberApiKey: true,
        });
      }

      return { success: true, nextState: "generating" };
    },

    skipAiSetup(): OrchestratorResult {
      preferencesPort.setPreferences({ skipAiSetup: true });
      return { success: true, nextState: "idle" };
    },

    handleModelError(
      modelId: DomainModelId,
      errorMessage?: string,
    ): OrchestratorResult {
      verificationPort.updateModelCacheMetadata(modelId, {
        downloadCompleted: false,
      });

      return {
        success: false,
        nextState: "error",
        error: errorMessage || "Failed to initialize model",
        errorCode: "network_failure",
      };
    },
  };
}

export type ModelDownloadOrchestrator = ReturnType<
  typeof createModelDownloadOrchestrator
>;
