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

export interface StageProgress {
  stage: number;
  label: string;
  durationMs?: number;
  chunks: string[];
}
