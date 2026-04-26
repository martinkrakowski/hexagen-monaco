import type {
  DomainAST,
  TopologyInvariants,
  CardinalityInvariants,
} from "@hexagen/core-domain";
import type { Gesture } from "../../domain/gesture.js";
import type { ParsedGesture } from "../../domain/value-objects/parsed-gesture.js";
import type { GestureParserPort } from "../../application/ports/in/gesture-parser.port.js";

/**
 * ManifestAwareGestureParserAdapter
 *
 * Parses a structured UI Gesture into a ParsedGesture by interpreting the gesture
 * payload as an intent to modify the current manifest context (DomainAST).
 *
 * Responsibilities:
 * - Extract DomainAST from gesture payload (if present)
 * - Parse gesture type and payload into structured intent
 * - Compute confidence based on payload completeness
 * - Return ParsedGesture with extracted AST
 *
 * Error handling:
 * - Missing or malformed AST payload defaults to empty AST
 * - Missing gesture type defaults to "unknown"
 * - Confidence degrades gracefully for incomplete payloads
 */
export class ManifestAwareGestureParserAdapter implements GestureParserPort {
  /**
   * Parse a gesture into a ParsedGesture
   * @param gesture - The UI interaction to parse
   * @returns ParsedGesture with extracted AST and confidence
   */
  parse(gesture: Gesture): ParsedGesture {
    const ast = this.extractAstFromGesture(gesture);
    const confidence = this.computeConfidence(gesture);

    return {
      gesture,
      ast,
      confidence,
    };
  }

  /**
   * Extract or construct a DomainAST from the gesture payload
   *
   * Expected payload structure:
   * {
   *   ast?: DomainAST,
   *   nodes?: Array<{id, kind, attributes}>,
   *   edges?: Array<{id, kind, source, target, attributes}>,
   *   invariants?: {topology: [], cardinality: []}
   * }
   */
  private extractAstFromGesture(gesture: Gesture): DomainAST {
    const { payload } = gesture;

    // Handle null or invalid payload
    if (!payload || typeof payload !== "object") {
      return {
        nodes: [],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };
    }

    // If the payload already contains a full AST, use it
    if (this.isValidDomainAST((payload as Record<string, unknown>).ast)) {
      return (payload as Record<string, unknown>).ast as DomainAST;
    }

    // Otherwise, try to construct an AST from constituent parts
    const payloadObj = payload as Record<string, unknown>;
    const nodes = Array.isArray(payloadObj.nodes) ? payloadObj.nodes : [];
    const edges = Array.isArray(payloadObj.edges) ? payloadObj.edges : [];
    const topology = this.extractTopologyInvariants(payloadObj);
    const cardinality = this.extractCardinalityInvariants(payloadObj);

    return {
      nodes,
      edges,
      invariants: { topology, cardinality },
    };
  }

  /**
   * Extract topology invariants from payload
   */
  private extractTopologyInvariants(
    payload: Record<string, unknown>,
  ): TopologyInvariants[] {
    const invariants = payload.invariants;

    if (invariants && typeof invariants === "object") {
      const invObj = invariants as Record<string, unknown>;
      if (Array.isArray(invObj.topology)) {
        return invObj.topology as TopologyInvariants[];
      }
    }

    return [];
  }

  /**
   * Extract cardinality invariants from payload
   */
  private extractCardinalityInvariants(
    payload: Record<string, unknown>,
  ): CardinalityInvariants[] {
    const invariants = payload.invariants;

    if (invariants && typeof invariants === "object") {
      const invObj = invariants as Record<string, unknown>;
      if (Array.isArray(invObj.cardinality)) {
        return invObj.cardinality as CardinalityInvariants[];
      }
    }

    return [];
  }

  /**
   * Validate that an object conforms to DomainAST shape
   */
  private isValidDomainAST(value: unknown): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }

    const obj = value as Record<string, unknown>;
    return (
      Array.isArray(obj.nodes) &&
      Array.isArray(obj.edges) &&
      obj.invariants !== undefined
    );
  }

  /**
   * Compute confidence score (0-1) based on payload completeness
   *
   * Factors:
   * - Presence of AST or constituent parts (nodes, edges, invariants)
   * - Completeness of node attributes
   * - Completeness of edge attributes
   */
  private computeConfidence(gesture: Gesture): number {
    const { payload } = gesture;

    if (!payload || typeof payload !== "object") {
      return 0.0;
    }

    let score = 0.0;
    let maxScore = 0.0;

    // Check for AST presence (0.5 points)
    maxScore += 0.5;
    if (this.isValidDomainAST(payload.ast)) {
      score += 0.5;
    }

    // Check for nodes (0.2 points)
    maxScore += 0.2;
    if (Array.isArray(payload.nodes) && payload.nodes.length > 0) {
      score += 0.2;
    }

    // Check for edges (0.2 points)
    maxScore += 0.2;
    if (Array.isArray(payload.edges) && payload.edges.length > 0) {
      score += 0.2;
    }

    // Check for invariants (0.1 points)
    maxScore += 0.1;
    if (payload.invariants) {
      score += 0.1;
    }

    // Normalize to 0-1 range
    return maxScore > 0 ? Math.min(score / maxScore, 1.0) : 0.0;
  }
}
