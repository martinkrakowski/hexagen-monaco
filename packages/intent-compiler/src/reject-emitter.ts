import { DomainAST, Identifier } from "@hexagen/core-domain";
import { TopologyInvariants } from "@hexagen/core-domain/mvk/v1";
import { CardinalityInvariants } from "@hexagen/core-domain/mvk/v1";

export interface Rejection {
  id: Identifier;
  reason: string;
  severity: "error" | "warning";
  gestureId?: Identifier;
  // Additional context for debugging
  invariantType?: string;
  payload?: unknown;
}

export class RejectEmitter {
  /**
   * Create a rejection from a topology invariant violation
   */
  emitTopologyViolation(
    violation: TopologyInvariants,
    gestureId?: Identifier,
  ): Rejection {
    return {
      id: this.generateId(),
      reason: this.formatTopologyViolationReason(violation),
      severity: "error",
      gestureId,
      invariantType: violation.type,
      payload: this.extractPayload(violation),
    };
  }

  /**
   * Create a rejection from a cardinality invariant violation
   */
  emitCardinalityViolation(
    violation: CardinalityInvariants,
    gestureId?: Identifier,
  ): Rejection {
    return {
      id: this.generateId(),
      reason: this.formatCardinalityViolationReason(violation),
      severity: "error",
      gestureId,
      invariantType: violation.type,
      payload: this.extractPayload(violation),
    };
  }

  /**
   * Create a generic rejection
   */
  emit(
    reason: string,
    severity: "error" | "warning" = "error",
    gestureId?: Identifier,
  ): Rejection {
    return {
      id: this.generateId(),
      reason,
      severity,
      gestureId,
    };
  }

  /**
   * Generate a unique identifier
   */
  private generateId(): Identifier {
    return (
      Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
    );
  }

  /**
   * Format a topology violation into a human-readable reason
   */
  private formatTopologyViolationReason(violation: TopologyInvariants): string {
    switch (violation.type) {
      case "Acyclic":
        return `Cycle detected in edge kind(s): ${violation.payload.appliesTo.join(", ")}`;
      case "Connected":
        return `Graph is not connected via edge kind(s): ${violation.payload.edgeKinds.join(", ")}`;
      case "Containment":
        return `Invalid containment: ${violation.payload.source} -${violation.payload.edgeKind}-> ${violation.payload.target}`;
      case "DegreeConstraint":
        return `Degree constraint violated for edge kind ${violation.payload.edgeKind} on nodes ${violation.payload.appliesTo.join(", ")}: expected ${violation.payload.min}-${violation.payload.max}`;
      default:
        return `Unknown topology violation: ${violation.type}`;
    }
  }

  /**
   * Format a cardinality violation into a human-readable reason
   */
  private formatCardinalityViolationReason(
    violation: CardinalityInvariants,
  ): string {
    switch (violation.type) {
      case "Exactly":
        return `Expected exactly ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
      case "AtLeast":
        return `Expected at least ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
      case "AtMost":
        return `Expected at most ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
      case "Between":
        return `Expected between ${violation.payload.min} and ${violation.payload.max} instances of ${violation.payload.nodeKind}`;
      default:
        return `Unknown cardinality violation: ${violation.type}`;
    }
  }

  /**
   * Safely extract payload from violation object
   */
  private extractPayload(
    obj: TopologyInvariants | CardinalityInvariants,
  ): unknown {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (obj as any).payload;
  }
}
