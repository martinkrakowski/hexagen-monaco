import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type { LayoutPosition } from "../../domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../domain/value-objects/stability-score.js";
import type { ScoreStabilityPort } from "../../application/ports/in/score-stability.port.js";
import { createStabilityScore } from "../../domain/value-objects/stability-score.js";

export class DefaultStabilityScorerAdapter implements ScoreStabilityPort {
  score(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): StabilityScore {
    let satisfied = 0;
    let violations = 0;

    for (const constraint of constraints) {
      if (this.isSatisfied(constraint, positions)) {
        satisfied++;
      } else {
        violations++;
      }
    }

    return createStabilityScore(satisfied, constraints.length, violations);
  }

  private isSatisfied(
    constraint: LayoutConstraint,
    positions: readonly LayoutPosition[],
  ): boolean {
    switch (constraint.type) {
      case "min-distance": {
        const payload = constraint.payload as {
          axis: string;
          minPixels: number;
        };
        if (payload.axis === "x" || payload.axis === "both") {
          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              const dist = Math.abs(positions[i].x - positions[j].x);
              if (dist < payload.minPixels) return false;
            }
          }
        }
        if (payload.axis === "y" || payload.axis === "both") {
          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              const dist = Math.abs(positions[i].y - positions[j].y);
              if (dist < payload.minPixels) return false;
            }
          }
        }
        return true;
      }
      case "group-boundary": {
        const payload = constraint.payload as {
          width: number;
          height: number;
          centerX: number;
          centerY: number;
        };
        const halfW = payload.width / 2;
        const halfH = payload.height / 2;
        return positions.every(
          (p) =>
            p.x >= payload.centerX - halfW &&
            p.x + p.width <= payload.centerX + halfW &&
            p.y >= payload.centerY - halfH &&
            p.y + p.height <= payload.centerY + halfH,
        );
      }
      default:
        return true;
    }
  }
}
