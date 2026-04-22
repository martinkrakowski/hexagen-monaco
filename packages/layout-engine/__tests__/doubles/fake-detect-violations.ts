import type { LayoutConstraint } from "../../src/domain/value-objects/layout-constraint.js";
import type {
  LayoutPosition,
  LayoutViolation,
} from "../../src/domain/value-objects/layout-result.js";
import type { DetectViolationsPort } from "../../src/application/ports/in/detect-violations.port.js";

export class FakeDetectViolationsAdapter implements DetectViolationsPort {
  callCount = 0;
  lastPositions: readonly LayoutPosition[] | null = null;
  lastConstraints: readonly LayoutConstraint[] | null = null;
  private forcedViolations: LayoutViolation[] | null = null;

  forceViolations(violations: LayoutViolation[]): void {
    this.forcedViolations = violations;
  }

  detect(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): LayoutViolation[] {
    this.callCount++;
    this.lastPositions = positions;
    this.lastConstraints = constraints;
    if (this.forcedViolations) return this.forcedViolations;
    return [];
  }
}
