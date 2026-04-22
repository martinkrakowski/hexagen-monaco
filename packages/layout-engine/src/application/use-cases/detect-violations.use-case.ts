import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type {
  LayoutPosition,
  LayoutViolation,
} from "../../domain/value-objects/layout-result.js";
import type { DetectViolationsPort } from "../ports/in/detect-violations.port.js";

export class DetectViolationsUseCase {
  constructor(private readonly detector: DetectViolationsPort) {}

  execute(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): LayoutViolation[] {
    return this.detector.detect(positions, constraints);
  }
}
