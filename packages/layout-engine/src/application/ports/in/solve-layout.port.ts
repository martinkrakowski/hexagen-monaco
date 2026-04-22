import type { LayoutConstraint } from "../../../domain/value-objects/layout-constraint.js";
import type { LayoutResult } from "../../../domain/value-objects/layout-result.js";

export interface SolveLayoutPort {
  solve(
    constraints: readonly LayoutConstraint[],
    nodeCount: number,
  ): LayoutResult;
}
