import {
  Identifier,
  TopologyInvariants,
  isAcyclicInvariant,
  isConnectedInvariant,
  isContainmentInvariant,
  isDegreeConstraintInvariant,
  CardinalityInvariants,
  isExactlyInvariant,
  isAtLeastInvariant,
  isAtMostInvariant,
  isBetweenInvariant,
} from "@hexagen/core-domain";

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
    if (isAcyclicInvariant(violation)) {
      return `Cycle detected in edge kind(s): ${violation.payload.appliesTo.join(", ")}`;
    }
    if (isConnectedInvariant(violation)) {
      return `Graph is not connected via edge kind(s): ${violation.payload.edgeKinds.join(", ")}`;
    }
    if (isContainmentInvariant(violation)) {
      return `Invalid containment: ${violation.payload.source} -${violation.payload.edgeKind}-> ${violation.payload.target}`;
    }
    if (isDegreeConstraintInvariant(violation)) {
      return `Degree constraint violated for edge kind ${violation.payload.edgeKind} on nodes ${violation.payload.appliesTo.join(", ")}: expected ${violation.payload.min}-${violation.payload.max}`;
    }
    return `Unknown topology violation`;
  }

  /**
   * Format a cardinality violation into a human-readable reason
   */
  private formatCardinalityViolationReason(
    violation: CardinalityInvariants,
  ): string {
    if (isExactlyInvariant(violation)) {
      return `Expected exactly ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
    }
    if (isAtLeastInvariant(violation)) {
      return `Expected at least ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
    }
    if (isAtMostInvariant(violation)) {
      return `Expected at most ${violation.payload.count} instances of ${violation.payload.nodeKind}`;
    }
    if (isBetweenInvariant(violation)) {
      return `Expected between ${violation.payload.min} and ${violation.payload.max} instances of ${violation.payload.nodeKind}`;
    }
    return `Unknown cardinality violation`;
  }

  /**
   * Safely extract payload from violation object
   */
  private extractPayload(
    obj: TopologyInvariants | CardinalityInvariants,
  ): unknown {
    return (obj as Record<string, unknown>).payload;
  }
}
