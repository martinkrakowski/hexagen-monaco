import type { ReactNode } from "react";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "../ModelSelectionFlow/useModelSelectionFlowState";

export type { ModelSelectionFlowState };

/**
 * Plan Workbench C1: the two right-pane slots GenerateWithAi produces when a
 * host mounts it inside the shared workbench (`renderWorkbench`). The host owns
 * the workbench shell (left column, layout); GenerateWithAi owns what fills the
 * right pane at every point of the generation flow.
 */
export interface GenerateWithAiWorkbenchSlots {
  /** Right-pane main content: the generate form body, the AiGeneratingStep
   * telemetry while a run is in flight/parked, or a flow-state view. */
  main: ReactNode;
  /** Bottom-pinned composer (replaces DescriptionInput + the ActionBar submit).
   * Absent during generation and in non-idle flow states. */
  composer?: ReactNode;
}

export interface GenerateWithAiProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (actions: GeneratingFooterActions | null) => void;
  /**
   * Plan Workbench C1: when provided, GenerateWithAi renders through this
   * callback instead of its single-column layout, handing the host `main` +
   * `composer` slots for the workbench's right pane. All flow behavior
   * (min-length gate, local-generation warning, /models detour, parked
   * telemetry) is identical in both modes — only the layout differs. Optional
   * so the single-column path stays intact for any host that has not adopted
   * the workbench (PR C2 relocates the remaining sections and retires it).
   */
  renderWorkbench?: (slots: GenerateWithAiWorkbenchSlots) => ReactNode;
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
