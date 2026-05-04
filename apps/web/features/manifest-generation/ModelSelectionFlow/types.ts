import type { DomainModelId } from "../../../lib/llm-interfaces";
import type { WelcomeFlowErrorCode } from "../WelcomeScreen/WelcomeFlowError";
import {
  transitionState,
  type WelcomeScreenState,
  type ModelSelectionEvent,
} from "@hexagen/manifest-generation";

export type { WelcomeScreenState };
export type { DomainModelId };

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

export function deriveStateFromEvent(
  currentState: WelcomeScreenState,
  event: ModelSelectionEvent,
): WelcomeScreenState {
  return transitionState(currentState, event);
}
