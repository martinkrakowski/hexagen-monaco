import type { ReactNode } from "react";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type { StageValidationReport } from "../useStagedGenerationStream";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "../ModelSelectionFlow/useModelSelectionFlowState";

export type { ModelSelectionFlowState };

/**
 * Plan Workbench C1/C2: the workbench slots GenerateWithAi produces for the
 * host's `renderWorkbench` callback. The host owns the workbench shell (left
 * column, layout); GenerateWithAi owns what fills the right pane at every
 * point of the generation flow, plus the left column's "Generation options"
 * section content.
 */
export interface GenerateWithAiWorkbenchSlots {
  /** Right-pane main content: the generate form body, the AiGeneratingStep
   * telemetry while a run is in flight/parked, or a flow-state view. */
  main: ReactNode;
  /** Bottom-pinned composer (the flow's single submit affordance). Absent
   * during generation and in non-idle flow states. */
  composer?: ReactNode;
  /** Left-column "Generation options" accordion content (Plan Workbench C2,
   * plan §3.6): deployment, max contexts, engine picker, change-model. Present
   * with the form AND during the generating screen (disabled there); absent in
   * non-idle flow states, mirroring the form body they belong to. */
  generationOptions?: ReactNode;
}

export interface GenerateWithAiProps {
  /**
   * Hand-off of the completed run. `validationReport` is the Stage-6 report
   * the stream's done event carried for exactly this manifest (null/absent on
   * older payloads) — the host stores it with the manifest so the accept view
   * renders the pipeline's findings instead of re-deriving heuristics.
   */
  onUseManifest?: (
    manifest: string,
    validationReport?: StageValidationReport | null,
  ) => void;
  llmContext: LocalLLMContext;
  onGeneratingStateChange?: (actions: GeneratingFooterActions | null) => void;
  /**
   * Plan Workbench C2: GenerateWithAi renders exclusively through this
   * callback, handing the host `main` + `composer` + `generationOptions`
   * slots for the shared workbench. REQUIRED — the legacy single-column
   * layout was retired in C2 (AIGenerationPage is the only consumer and
   * always mounts the workbench), so there is no fallback rendering path.
   */
  renderWorkbench: (slots: GenerateWithAiWorkbenchSlots) => ReactNode;
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
