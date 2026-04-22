import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type { LayoutResult } from "../../domain/value-objects/layout-result.js";
import type { SolveLayoutPort } from "../ports/in/solve-layout.port.js";

export class SolveLayoutUseCase {
  constructor(private readonly solver: SolveLayoutPort) {}

  execute(
    constraints: readonly LayoutConstraint[],
    nodeCount: number,
  ): LayoutResult {
    return this.solver.solve(constraints, nodeCount);
  }
}
