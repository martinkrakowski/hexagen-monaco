import type { StabilityScore } from "./stability-score.js";

export interface LayoutPosition {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LayoutResult =
  | {
      success: true;
      positions: readonly LayoutPosition[];
      score: StabilityScore;
    }
  | { success: false; violations: LayoutViolation[] };

export interface LayoutViolation {
  readonly constraintId: string;
  readonly constraintType: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}
