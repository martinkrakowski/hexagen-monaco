import type { DomainModelId } from "../../../lib/llm-interfaces";
import type { GenerateWithAiErrorCode } from "../GenerateWithAi/GenerateWithAiError";
import {
  transitionState,
  type GenerateWithAiScreenState,
  type ModelSelectionEvent,
} from "@hexagen/manifest-generation";

export type { GenerateWithAiScreenState };
export type { DomainModelId };

export interface ModelSelectionFlowState {
  state: GenerateWithAiScreenState;
  error?: string | null;
  errorCode?: GenerateWithAiErrorCode | null;
  aiSetupSkipped?: boolean;
  selectedModelId?: DomainModelId | null;
  cloudApiKey?: string | null;
  rememberedChoice?: boolean;
  cloudProvider?: "openai" | "anthropic" | "azure" | "other";
  generationProgress?: number;
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

export interface ModelSelectionFlowActions {
  transitionTo: (state: GenerateWithAiScreenState) => void;
  selectLocalModel: (modelId: DomainModelId, remember: boolean) => void;
  selectCloudProvider: (
    provider: string,
    apiKey: string,
    remember: boolean,
  ) => void;
  skipAiSetup: () => void;
  cancelModelDownload: () => void;
  setError: (message: string, errorCode?: GenerateWithAiErrorCode) => void;
  clearError: () => void;
  retryGeneration: () => void;
  restartFromSelection: () => void;
  proceedToWizard: () => void;
  clearStoredApiKey: () => Promise<void>;
  validateApiKey: (provider: string, key: string) => Promise<boolean>;
  loadSavedApiKey: (provider: string) => Promise<string | null>;
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

export function deriveStateFromEvent(
  currentState: GenerateWithAiScreenState,
  event: ModelSelectionEvent,
): GenerateWithAiScreenState {
  return transitionState(currentState, event);
}
