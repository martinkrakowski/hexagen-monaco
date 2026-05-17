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
}
