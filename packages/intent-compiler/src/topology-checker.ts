import {
  DomainAST,
  DomainEdge,
  TopologyInvariants,
} from "@hexagen/core-domain";

export interface TopologyCheckResult {
  valid: boolean;
  violations: TopologyInvariants[];
}

export class TopologyChecker {
  check(ast: DomainAST): TopologyCheckResult {
    const violations: TopologyInvariants[] = [];

    // Check for self-loops (edges where source equals target)
    for (const edge of ast.edges) {
      if (edge.source === edge.target) {
        violations.push({
          type: "Acyclic",
          payload: {
            appliesTo: [edge.kind],
          },
        });
      }
    }

    // Check for disconnected components (simplified: if there are edges,
    // all nodes should be connected in some way)
    if (ast.nodes.length > 0 && ast.edges.length === 0) {
      violations.push({
        type: "Connected",
        payload: {
          edgeKinds: [],
          rootNodeKinds: [],
        },
      });
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
