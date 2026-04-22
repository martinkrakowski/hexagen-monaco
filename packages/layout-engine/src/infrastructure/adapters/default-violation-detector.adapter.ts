import type { LayoutConstraint } from "../../domain/value-objects/layout-constraint.js";
import type {
  LayoutPosition,
  LayoutViolation,
} from "../../domain/value-objects/layout-result.js";
import type { DetectViolationsPort } from "../../application/ports/in/detect-violations.port.js";

export class DefaultViolationDetectorAdapter implements DetectViolationsPort {
  detect(
    positions: readonly LayoutPosition[],
    constraints: readonly LayoutConstraint[],
  ): LayoutViolation[] {
    const violations: LayoutViolation[] = [];

    for (const constraint of constraints) {
      switch (constraint.type) {
        case "min-distance": {
          const payload = constraint.payload as {
            axis: string;
            minPixels: number;
          };
          this.checkMinDistance(constraint.id, payload, positions, violations);
          break;
        }
        case "group-boundary": {
          const payload = constraint.payload as {
            width: number;
            height: number;
            centerX: number;
            centerY: number;
          };
          this.checkGroupBoundary(
            constraint.id,
            payload,
            positions,
            violations,
          );
          break;
        }
        case "containment": {
          const payload = constraint.payload as {
            containerId: string;
            padding: number;
          };
          this.checkContainment(constraint.id, payload, positions, violations);
          break;
        }
      }
    }

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        if (this.overlaps(positions[i], positions[j])) {
          violations.push({
            constraintId: `overlap-${positions[i].nodeId}-${positions[j].nodeId}`,
            constraintType: "overlap",
            message: `Nodes ${positions[i].nodeId} and ${positions[j].nodeId} overlap`,
            severity: "error",
          });
        }
      }
    }

    return violations;
  }

  private checkMinDistance(
    constraintId: string,
    payload: { axis: string; minPixels: number },
    positions: readonly LayoutPosition[],
    violations: LayoutViolation[],
  ): void {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist =
          payload.axis === "x"
            ? Math.abs(positions[i].x - positions[j].x)
            : payload.axis === "y"
              ? Math.abs(positions[i].y - positions[j].y)
              : Math.max(
                  Math.abs(positions[i].x - positions[j].x),
                  Math.abs(positions[i].y - positions[j].y),
                );
        if (dist < payload.minPixels) {
          violations.push({
            constraintId,
            constraintType: "min-distance",
            message: `Distance between ${positions[i].nodeId} and ${positions[j].nodeId} is ${dist}px, below minimum ${payload.minPixels}px`,
            severity: "warning",
          });
        }
      }
    }
  }

  private checkGroupBoundary(
    constraintId: string,
    payload: {
      width: number;
      height: number;
      centerX: number;
      centerY: number;
    },
    positions: readonly LayoutPosition[],
    violations: LayoutViolation[],
  ): void {
    const halfW = payload.width / 2;
    const halfH = payload.height / 2;
    for (const pos of positions) {
      if (
        pos.x < payload.centerX - halfW ||
        pos.x + pos.width > payload.centerX + halfW ||
        pos.y < payload.centerY - halfH ||
        pos.y + pos.height > payload.centerY + halfH
      ) {
        violations.push({
          constraintId,
          constraintType: "group-boundary",
          message: `Node ${pos.nodeId} exceeds group boundary`,
          severity: "error",
        });
      }
    }
  }

  private checkContainment(
    constraintId: string,
    payload: { containerId: string; padding: number },
    positions: readonly LayoutPosition[],
    violations: LayoutViolation[],
  ): void {
    const container = positions.find((p) => p.nodeId === payload.containerId);
    if (!container) return;

    for (const pos of positions) {
      if (pos.nodeId === payload.containerId) continue;
      if (
        pos.x < container.x + payload.padding ||
        pos.x + pos.width > container.x + container.width - payload.padding ||
        pos.y < container.y + payload.padding ||
        pos.y + pos.height > container.y + container.height - payload.padding
      ) {
        violations.push({
          constraintId,
          constraintType: "containment",
          message: `Node ${pos.nodeId} not contained within ${payload.containerId}`,
          severity: "warning",
        });
      }
    }
  }

  private overlaps(a: LayoutPosition, b: LayoutPosition): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }
}
