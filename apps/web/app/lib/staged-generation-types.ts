/** Current phase of a staged manifest generation pipeline */
export type StagedPhase =
  | "idle"
  | "stage-0"
  | "stage-1"
  | "stage-2"
  | "stage-3"
  | "stage-4"
  | "stage-5"
  | "stage-6"
  | "complete"
  | "failed";

/** Progress snapshot for a single stage within a staged generation */
import type { StageTelemetry } from "@hexagen/agentic-interaction";

export interface StageProgress {
  stage: number;
  label: string;
  durationMs?: number;
  chunks: string[];
  /** Full telemetry, available after stage completion */
  telemetry?: StageTelemetry;
  /**
   * Terminal-state marker written only by the local (WebLLM) progress mapping
   * in `mapLocalLLMProgressCallbacks.ts`. The cloud stream path leaves it
   * undefined and derives completion from stage-index vs. current phase
   * ordering instead, so treat `undefined` as "unknown", not "not completed".
   */
  completed?: boolean;
  /**
   * Failure message for the stage. Written only by the local (WebLLM) progress
   * mapping; the cloud stream path surfaces stage failures through the hook's
   * `generationError` / terminal `error` frame instead.
   */
  error?: string;
}
