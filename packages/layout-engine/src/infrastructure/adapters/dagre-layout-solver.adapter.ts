import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type {
  LayoutResult,
  LayoutPosition,
} from "../../domain/value-objects/layout-result.js";
import type { StabilityScore } from "../../domain/value-objects/stability-score.js";
import type { SolveLayoutPort } from "../../application/ports/in/solve-layout.port.js";
import { createStabilityScore } from "../../domain/value-objects/stability-score.js";

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 160;
const DEFAULT_SPACING_X = 200;
const DEFAULT_SPACING_Y = 200;
const DEFAULT_OFFSET_X = 100;
const DEFAULT_OFFSET_Y = 100;

export class DagreLayoutSolverAdapter implements SolveLayoutPort {
  solve(
    constraints: readonly LayoutConstraint[],
    nodeCount: number,
  ): LayoutResult {
    const groupConstraint = constraints.find(
      (
        c,
      ): c is LayoutConstraint & {
        payload: {
          width: number;
          height: number;
          centerX: number;
          centerY: number;
        };
      } => c.type === "group-boundary",
    );

    const minDistConstraint = constraints.find(
      (
        c,
      ): c is LayoutConstraint & {
        payload: { axis: string; minPixels: number };
      } => c.type === "min-distance",
    );

    const spacingX = minDistConstraint?.payload.minPixels ?? DEFAULT_SPACING_X;
    const spacingY = minDistConstraint?.payload.minPixels ?? DEFAULT_SPACING_Y;

    const positions: LayoutPosition[] = [];

    const startX = groupConstraint?.payload.centerX ?? DEFAULT_OFFSET_X;
    const startY = groupConstraint?.payload.centerY ?? DEFAULT_OFFSET_Y;

    const cols = Math.max(1, Math.floor(Math.sqrt(nodeCount)));
    const nodeWidth = DEFAULT_NODE_WIDTH;
    const nodeHeight = DEFAULT_NODE_HEIGHT;

    for (let i = 0; i < nodeCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        nodeId: `node-${i}`,
        x: startX + col * spacingX - (cols * spacingX) / 2,
        y:
          startY +
          row * spacingY -
          (Math.ceil(nodeCount / cols) * spacingY) / 2,
        width: nodeWidth,
        height: nodeHeight,
      });
    }

    const violations = this.detectOverlapViolations(positions, constraints);

    const satisfiedConstraints = constraints.length - violations.length;

    const score: StabilityScore = createStabilityScore(
      Math.max(0, satisfiedConstraints),
      constraints.length,
      violations.length,
    );

    if (violations.length > 0) {
      return {
        success: false,
        violations,
      };
    }

    return {
      success: true,
      positions,
      score,
    };
  }

  private detectOverlapViolations(
    positions: readonly LayoutPosition[],
    _constraints: readonly LayoutConstraint[],
  ): Array<{
    constraintId: string;
    constraintType: string;
    message: string;
    severity: "error" | "warning";
  }> {
    const violations: Array<{
      constraintId: string;
      constraintType: string;
      message: string;
      severity: "error" | "warning";
    }> = [];

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        if (overlaps) {
          violations.push({
            constraintId: `overlap-${a.nodeId}-${b.nodeId}`,
            constraintType: "overlap",
            message: `Nodes ${a.nodeId} and ${b.nodeId} overlap`,
            severity: "error",
          });
        }
      }
    }

    return violations;
  }
}
