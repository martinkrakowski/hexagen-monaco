import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "../ModelSelectionFlow/useModelSelectionFlowState";

export type { ModelSelectionFlowState };

export interface GenerateWithAiProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (actions: GeneratingFooterActions | null) => void;
}

export interface GeneratingFooterActions {
  onCancel: () => void;
  /**
   * Present once generation has completed successfully: the manifest is
   * parked on the telemetry screen and this advances to /ai/accept. Absent
   * while generation is still in flight.
   */
  onNext?: () => void;
}

export interface EntryPointsSectionProps {
  onImportManifest: () => void;
  onStartWizard: () => void;
  onImportGithub?: () => void;
}

export interface HeaderSectionProps {
  title: string;
  subtitle: string;
}

export interface ActionBarProps {
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
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
  onConfirmAndContinue: () => void;
  onRetryFromError: () => void;
}
