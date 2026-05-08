import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "../ModelSelectionFlow/useModelSelectionFlowState";

export type { ModelSelectionFlowState };

export interface GenerateWithAiProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (isGenerating: boolean) => void;
}

export interface EntryPointsSectionProps {
  onImportManifest: () => void;
  onStartWizard: () => void;
  onImportGithub?: () => void;
}

export interface PreviousProjectsSectionProps {
  onLoadProject: (id: string) => void;
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
  maxContexts: number;
  onMaxContextsChange: (value: number) => void;
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
  disabledTooltip?: string;
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
  flowState: ModelSelectionFlowState;
  actions: ModelSelectionFlowActions;
  onUseManifest?: (manifest: string) => void;
  onConfirmAndContinue: () => void;
  onRegenerate: () => void;
  onRetryFromError: () => void;
}
