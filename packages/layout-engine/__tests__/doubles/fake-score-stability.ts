import type { LayoutConstraint } from "../../src/domain/value-objects/layout-constraint.js";
import type { LayoutPosition } from "../../src/domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../src/domain/value-objects/stability-score.js";
import type { ScoreStabilityPort } from "../../src/application/ports/in/score-stability.port.js";
import { createStabilityScore } from "../../src/domain/value-objects/stability-score.js";

export class FakeScoreStabilityAdapter implements ScoreStabilityPort {
  callCount = 0;
  lastPositions: readonly LayoutPosition[] | null = null;
  lastConstraints: readonly LayoutConstraint[] | null = null;
  private forcedScore: StabilityScore | null = null;

  forceScore(score: StabilityScore): void {
    this.forcedScore = score;
  }

  score(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): StabilityScore {
    this.callCount++;
    this.lastPositions = positions;
    this.lastConstraints = constraints;
    if (this.forcedScore) return this.forcedScore;
    return createStabilityScore(constraints.length, constraints.length, 0);
  }
}
