import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type { LayoutPosition } from "../../domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../domain/value-objects/stability-score.js";
import type { ScoreStabilityPort } from "../ports/in/score-stability.port.js";

export class ScoreStabilityUseCase {
  constructor(private readonly scorer: ScoreStabilityPort) {}

  execute(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): StabilityScore {
    return this.scorer.score(positions, constraints);
  }
}
