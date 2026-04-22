import type { LayoutConstraint } from "../../src/domain/value-objects/layout-constraint.js";
import type {
  LayoutResult,
  LayoutPosition,
} from "../../src/domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../src/domain/value-objects/stability-score.js";
import type { SolveLayoutPort } from "../../src/application/ports/in/solve-layout.port.js";
import { createStabilityScore } from "../../src/domain/value-objects/stability-score.js";

export class FakeSolveLayoutAdapter implements SolveLayoutPort {
  callCount = 0;
  lastConstraints: readonly LayoutConstraint[] | null = null;
  lastNodeCount: number | null = null;
  private forcedResult: LayoutResult | null = null;

  forceResult(result: LayoutResult): void {
    this.forcedResult = result;
  }

  solve(
    constraints: readonly LayoutConstraint[],
    nodeCount: number,
  ): LayoutResult {
    this.callCount++;
    this.lastConstraints = constraints;
    this.lastNodeCount = nodeCount;
    if (this.forcedResult) return this.forcedResult;
    const positions: LayoutPosition[] = Array.from(
      { length: nodeCount },
      (_, i) => ({
        nodeId: `node-${i}`,
        x: i * 200,
        y: 100,
        width: 160,
        height: 160,
      }),
    );
    const score: StabilityScore = createStabilityScore(
      constraints.length,
      constraints.length,
      0,
    );
    return { success: true, positions, score };
  }
}
