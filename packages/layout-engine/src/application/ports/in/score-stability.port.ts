import type { LayoutConstraint } from "../../../domain/value-objects/layout-constraint.js";
import type { LayoutPosition } from "../../../domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../../domain/value-objects/stability-score.js";

export interface ScoreStabilityPort {
  score(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): StabilityScore;
}
