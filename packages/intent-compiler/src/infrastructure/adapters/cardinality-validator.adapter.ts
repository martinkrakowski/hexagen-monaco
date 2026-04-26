import type { DomainAST, CardinalityInvariants } from "@hexagen/core-domain";
import type { CardinalityCheckResult } from "../../domain/value-objects/cardinality-check-result.js";
import type { CardinalityCheckerPort } from "../../application/ports/in/cardinality-checker.port.js";

/**
 * CardinalityValidatorAdapter
 *
 * Validates a DomainAST against all defined cardinality invariants.
 *
 * Responsibilities:
 * - Check Exactly invariants (enforce exact node count)
 * - Check AtLeast invariants (enforce minimum node count)
 * - Check AtMost invariants (enforce maximum node count)
 * - Check Between invariants (enforce range-based node count)
 *
 * Implementation notes:
 * - Groups nodes by kind for efficient counting
 * - Generates descriptive violation messages with counts
 *
 * @implements {CardinalityCheckerPort}
 */
export class CardinalityValidatorAdapter implements CardinalityCheckerPort {
  check(ast: DomainAST): CardinalityCheckResult {
    const violations: string[] = [];

    if (!ast.invariants || !ast.invariants.cardinality) {
      return {
        isValid: true,
        violations: [],
      };
    }

    // Build a map of node kinds to node counts
    const nodeCounts = new Map<string, number>();
    for (const node of ast.nodes) {
      nodeCounts.set(node.kind, (nodeCounts.get(node.kind) ?? 0) + 1);
    }

    // Validate each cardinality invariant
    for (const invariant of ast.invariants.cardinality) {
      const invariantViolations = this.validateInvariant(invariant, nodeCounts);
      violations.push(...invariantViolations);
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * Validate a single cardinality invariant
   */
  private validateInvariant(
    invariant: CardinalityInvariants,
    nodeCounts: Map<string, number>,
  ): string[] {
    switch (invariant.type) {
      case "Exactly":
        return this.validateExactly(invariant.payload, nodeCounts);
      case "AtLeast":
        return this.validateAtLeast(invariant.payload, nodeCounts);
      case "AtMost":
        return this.validateAtMost(invariant.payload, nodeCounts);
      case "Between":
        return this.validateBetween(invariant.payload, nodeCounts);
      default:
        return [];
    }
  }

  /**
   * Validate Exactly invariant
   * Ensures exactly N instances of a node kind exist
   */
  private validateExactly(
    payload: { nodeKind: string; count: number },
    nodeCounts: Map<string, number>,
  ): string[] {
    const actual = nodeCounts.get(payload.nodeKind) ?? 0;

    if (actual === payload.count) {
      return [];
    }

    return [
      `Exactly violation: node kind "${payload.nodeKind}" has ${actual} instances, expected exactly ${payload.count}`,
    ];
  }

  /**
   * Validate AtLeast invariant
   * Ensures at least N instances of a node kind exist
   */
  private validateAtLeast(
    payload: { nodeKind: string; count: number },
    nodeCounts: Map<string, number>,
  ): string[] {
    const actual = nodeCounts.get(payload.nodeKind) ?? 0;

    if (actual >= payload.count) {
      return [];
    }

    return [
      `AtLeast violation: node kind "${payload.nodeKind}" has ${actual} instances, expected at least ${payload.count}`,
    ];
  }

  /**
   * Validate AtMost invariant
   * Ensures at most N instances of a node kind exist
   */
  private validateAtMost(
    payload: { nodeKind: string; count: number },
    nodeCounts: Map<string, number>,
  ): string[] {
    const actual = nodeCounts.get(payload.nodeKind) ?? 0;

    if (actual <= payload.count) {
      return [];
    }

    return [
      `AtMost violation: node kind "${payload.nodeKind}" has ${actual} instances, expected at most ${payload.count}`,
    ];
  }

  /**
   * Validate Between invariant
   * Ensures between min and max instances (inclusive) of a node kind exist
   */
  private validateBetween(
    payload: { nodeKind: string; min: number; max: number },
    nodeCounts: Map<string, number>,
  ): string[] {
    const actual = nodeCounts.get(payload.nodeKind) ?? 0;

    if (actual >= payload.min && actual <= payload.max) {
      return [];
    }

    return [
      `Between violation: node kind "${payload.nodeKind}" has ${actual} instances, expected between ${payload.min} and ${payload.max}`,
    ];
  }
}
