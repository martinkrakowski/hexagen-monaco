import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "../ModelSelectionFlow/useModelSelectionFlowState";
import type { ViewTab } from "../ManifestPreview";

export type { ModelSelectionFlowState };
export type { ViewTab };

export interface GenerateWithAiProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (actions: GeneratingFooterActions | null) => void;
  onPreviewStateChange?: (actions: PreviewFooterActions | null) => void;
}

export interface GeneratingFooterActions {
  onCancel: () => void;
}

export interface PreviewFooterActions {
  onBack: () => void;
  onRegenerate: () => void;
  onUseManifest: (yaml: string) => void;
  manifestYaml: string;
  hasFailures: boolean;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  overallScore: number;
  systemLabel: string;
  architectureLabel: string;
  contextCount: number;
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
  onUseManifest?: (manifest: string) => void;
  onConfirmAndContinue: () => void;
  onRegenerate: () => void;
  onRetryFromError: () => void;
  onYamlChange?: (yaml: string) => void;
  externalActiveTab?: ViewTab;
  onTabChange?: (tab: ViewTab) => void;
}
