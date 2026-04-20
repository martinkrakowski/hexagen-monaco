import { DomainAST, CardinalityInvariants } from "@hexagen/core-domain";

export interface CardinalityCheckResult {
  valid: boolean;
  violations: CardinalityInvariants[];
}

export class CardinalityChecker {
  check(ast: DomainAST): CardinalityCheckResult {
    const violations: CardinalityInvariants[] = [];

    // Count nodes by kind
    const nodeCountByKind: Record<string, number> = {};
    for (const node of ast.nodes) {
      const kind = node.kind;
      nodeCountByKind[kind] = (nodeCountByKind[kind] || 0) + 1;
    }

    // Check each invariant
    for (const invariant of ast.invariants.cardinality) {
      switch (invariant.type) {
        case "Exactly": {
          const expectedCount = invariant.payload.count;
          const actualCount = nodeCountByKind[invariant.payload.nodeKind] || 0;
          if (actualCount !== expectedCount) {
            violations.push({
              type: "Exactly",
              payload: {
                nodeKind: invariant.payload.nodeKind,
                count: expectedCount,
              },
            });
          }
          break;
        }
        case "AtLeast": {
          const minCount = invariant.payload.count;
          const actualCount = nodeCountByKind[invariant.payload.nodeKind] || 0;
          if (actualCount < minCount) {
            violations.push({
              type: "AtLeast",
              payload: {
                nodeKind: invariant.payload.nodeKind,
                count: minCount,
              },
            });
          }
          break;
        }
        case "AtMost": {
          const maxCount = invariant.payload.count;
          const actualCount = nodeCountByKind[invariant.payload.nodeKind] || 0;
          if (actualCount > maxCount) {
            violations.push({
              type: "AtMost",
              payload: {
                nodeKind: invariant.payload.nodeKind,
                count: maxCount,
              },
            });
          }
          break;
        }
        case "Between": {
          const minCount = invariant.payload.min;
          const maxCount = invariant.payload.max;
          const actualCount = nodeCountByKind[invariant.payload.nodeKind] || 0;
          if (actualCount < minCount || actualCount > maxCount) {
            violations.push({
              type: "Between",
              payload: {
                nodeKind: invariant.payload.nodeKind,
                min: minCount,
                max: maxCount,
              },
            });
          }
          break;
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
