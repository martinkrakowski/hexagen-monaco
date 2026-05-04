import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type {
  WelcomeFlowState,
  WelcomeFlowActions,
} from "../ModelSelectionFlow/useWelcomeFlowState";

export type { WelcomeFlowState };

export interface WelcomeScreenProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (isGenerating: boolean) => void;
}

export interface HeaderSectionProps {
  title: string;
  subtitle: string;
}

export interface FormSectionProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  platform: string;
  onPlatformChange: (value: string) => void;
  deployment: string;
  onDeploymentChange: (value: string) => void;
  selectedExample: number | null;
  onUseExample: (example: string, index: number) => void;
  charCount: number;
  isDisabled: boolean;
}

export interface ModelCapabilityCheckProps {
  modelNativelyCapable: boolean;
  manifestCapable: boolean;
  loadedModelId: string | null;
  overrideModelCheck: boolean;
  onOverrideChange: (value: boolean) => void;
  onSwitchModel: () => void;
}

export interface ActionBarProps {
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onCancel?: () => void;
}

export interface ClientManifestGenerationResult {
  phase: string;
  generateManifest: (
    description: string,
    signal: AbortSignal,
  ) => Promise<{ manifest: string; clarifications?: unknown[] }>;
  reset: () => void;
}

export interface StateViewProps {
  flowState: WelcomeFlowState;
  actions: WelcomeFlowActions;
  onUseManifest?: (manifest: string) => void;
  onConfirmAndContinue: () => void;
  onRegenerate: () => void;
  onRetryFromError: () => void;
}
