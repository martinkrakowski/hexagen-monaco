import type { LayoutConstraint } from "../../../domain/value-objects/layout-constraint.js";
import type {
  LayoutViolation,
  LayoutPosition,
} from "../../../domain/value-objects/layout-result.js";

export interface DetectViolationsPort {
  detect(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): LayoutViolation[];
}
