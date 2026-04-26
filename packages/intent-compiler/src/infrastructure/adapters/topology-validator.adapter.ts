import type { DomainAST, TopologyInvariants } from "@hexagen/core-domain";
import type { TopologyCheckResult } from "../../domain/value-objects/topology-check-result.js";
import type { TopologyCheckerPort } from "../../application/ports/in/topology-checker.port.js";

/**
 * TopologyValidatorAdapter
 *
 * Validates a DomainAST against all defined topology invariants.
 *
 * Responsibilities:
 * - Check Acyclic invariants (detect cycles in specified edge kinds)
 * - Check Containment invariants (ensure edge connectivity respects node type rules)
 * - Check DegreeConstraint invariants (enforce min/max edge cardinality per node)
 * - Check Connected invariants (ensure graph connectivity)
 *
 * Implementation notes:
 * - Uses depth-first search for cycle detection
 * - Validates edge source/target node kinds for containment rules
 * - Counts incident edges per node for degree constraints
 *
 * @implements {TopologyCheckerPort}
 */
export class TopologyValidatorAdapter implements TopologyCheckerPort {
  check(ast: DomainAST): TopologyCheckResult {
    const violations: string[] = [];

    if (!ast.invariants || !ast.invariants.topology) {
      return {
        isValid: true,
        violations: [],
      };
    }

    // Validate each topology invariant
    for (const invariant of ast.invariants.topology) {
      const invariantViolations = this.validateInvariant(invariant, ast);
      violations.push(...invariantViolations);
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * Validate a single topology invariant against the AST
   */
  private validateInvariant(
    invariant: TopologyInvariants,
    ast: DomainAST,
  ): string[] {
    switch (invariant.type) {
      case "Acyclic":
        return this.validateAcyclic(invariant.payload, ast);
      case "Containment":
        return this.validateContainment(invariant.payload, ast);
      case "DegreeConstraint":
        return this.validateDegreeConstraint(invariant.payload, ast);
      case "Connected":
        return this.validateConnected(invariant.payload, ast);
      default:
        return [];
    }
  }

  /**
   * Validate acyclicity for specified edge kinds
   * Uses depth-first search with color marking (white, gray, black)
   */
  private validateAcyclic(
    payload: { appliesTo: string[] },
    ast: DomainAST,
  ): string[] {
    const violations: string[] = [];
    const allowedEdgeKinds = new Set(payload.appliesTo);

    // Build adjacency list for relevant edges
    const graph = new Map<string, string[]>();
    for (const edge of ast.edges) {
      if (allowedEdgeKinds.has(edge.kind)) {
        if (!graph.has(edge.source)) {
          graph.set(edge.source, []);
        }
        graph.get(edge.source)!.push(edge.target);
      }
    }

    // Color map: white=0, gray=1, black=2
    const colors = new Map<string, number>();

    // DFS to detect cycles
    const hasCycle = (nodeId: string, path: string[]): boolean => {
      colors.set(nodeId, 1); // Mark as gray (in progress)
      const neighbors = graph.get(nodeId) || [];

      for (const neighbor of neighbors) {
        const color = colors.get(neighbor) ?? 0;

        if (color === 1) {
          // Back edge found (cycle)
          violations.push(
            `Cycle detected in Acyclic invariant: ${[...path, nodeId, neighbor].join(" -> ")}`,
          );
          return true;
        }

        if (color === 0) {
          // White node, recurse
          if (hasCycle(neighbor, [...path, nodeId])) {
            return true;
          }
        }
      }

      colors.set(nodeId, 2); // Mark as black (complete)
      return false;
    };

    // Visit all nodes
    for (const nodeId of Array.from(graph.keys())) {
      if ((colors.get(nodeId) ?? 0) === 0) {
        hasCycle(nodeId, []);
      }
    }

    return violations;
  }

  /**
   * Validate containment invariants
   * Ensures edges of specified kind only connect allowed node type combinations
   */
  private validateContainment(
    payload: { source: string; edgeKind: string; target: string },
    ast: DomainAST,
  ): string[] {
    const violations: string[] = [];
    const nodeKinds = new Map(ast.nodes.map((n) => [n.id, n.kind]));

    for (const edge of ast.edges) {
      if (edge.kind !== payload.edgeKind) {
        continue;
      }

      const sourceKind = nodeKinds.get(edge.source);
      const targetKind = nodeKinds.get(edge.target);

      if (sourceKind !== payload.source) {
        violations.push(
          `Containment violation: edge ${edge.id} (${edge.kind}) source node ${edge.source} has kind "${sourceKind}", expected "${payload.source}"`,
        );
      }

      if (targetKind !== payload.target) {
        violations.push(
          `Containment violation: edge ${edge.id} (${edge.kind}) target node ${edge.target} has kind "${targetKind}", expected "${payload.target}"`,
        );
      }
    }

    return violations;
  }

  /**
   * Validate degree constraints
   * Ensures each node has the correct number of edges of specified kinds
   */
  private validateDegreeConstraint(
    payload: {
      edgeKind: string;
      min: number;
      max: number;
      appliesTo: string[];
    },
    ast: DomainAST,
  ): string[] {
    const violations: string[] = [];
    const applicableNodeKinds = new Set(payload.appliesTo);
    const nodeKindMap = new Map(ast.nodes.map((n) => [n.id, n.kind]));

    // Count incident edges per node
    const edgeCounts = new Map<string, number>();
    for (const node of ast.nodes) {
      edgeCounts.set(node.id, 0);
    }

    for (const edge of ast.edges) {
      if (edge.kind === payload.edgeKind) {
        edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
        edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
      }
    }

    // Check degree constraints
    for (const node of ast.nodes) {
      // Skip if constraint doesn't apply to this node kind
      if (applicableNodeKinds.size > 0 && !applicableNodeKinds.has(node.kind)) {
        continue;
      }

      const count = edgeCounts.get(node.id) ?? 0;

      if (count < payload.min) {
        violations.push(
          `DegreeConstraint violation: node ${node.id} (${node.kind}) has ${count} edges of kind "${payload.edgeKind}", minimum is ${payload.min}`,
        );
      }

      if (count > payload.max) {
        violations.push(
          `DegreeConstraint violation: node ${node.id} (${node.kind}) has ${count} edges of kind "${payload.edgeKind}", maximum is ${payload.max}`,
        );
      }
    }

    return violations;
  }

  /**
   * Validate connected invariant
   * Ensures all nodes are reachable via specified edge kinds
   */
  private validateConnected(
    payload: { edgeKinds: string[]; rootNodeKinds?: string[] },
    ast: DomainAST,
  ): string[] {
    const violations: string[] = [];

    if (ast.nodes.length === 0) {
      return [];
    }

    const allowedEdgeKinds = new Set(payload.edgeKinds);
    const rootNodeKinds = payload.rootNodeKinds
      ? new Set(payload.rootNodeKinds)
      : null;

    // Build adjacency list for relevant edges (bidirectional for connectivity)
    const graph = new Map<string, Set<string>>();
    for (const node of ast.nodes) {
      graph.set(node.id, new Set());
    }

    for (const edge of ast.edges) {
      if (allowedEdgeKinds.has(edge.kind)) {
        graph.get(edge.source)?.add(edge.target);
        graph.get(edge.target)?.add(edge.source); // Bidirectional for connectivity
      }
    }

    // Find root nodes
    let rootNodes: string[] = [];
    if (rootNodeKinds) {
      rootNodes = ast.nodes
        .filter((n) => rootNodeKinds.has(n.kind))
        .map((n) => n.id);
    }

    // If no root nodes found or specified, use the first node as root
    if (rootNodes.length === 0 && ast.nodes.length > 0) {
      rootNodes = [ast.nodes[0].id];
    }

    // BFS from each root to find reachable nodes
    const reachable = new Set<string>();
    for (const root of rootNodes) {
      const queue = [root];
      const visited = new Set<string>([root]);

      while (queue.length > 0) {
        const current = queue.shift()!;
        reachable.add(current);

        for (const neighbor of graph.get(current) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    // Check if all nodes are reachable
    for (const node of ast.nodes) {
      if (!reachable.has(node.id)) {
        violations.push(
          `Connected violation: node ${node.id} (${node.kind}) is not reachable from root nodes`,
        );
      }
    }

    return violations;
  }
}
