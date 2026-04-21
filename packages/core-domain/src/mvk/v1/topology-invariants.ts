/**
 * TopologyInvariants - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

import { NodeKind } from "./node-kind";
import { EdgeKind } from "./edge-kind";

/**
 * TopologyInvariants - Type-level invariants that enforce structural constraints on the DomainAST
 */
export type TopologyInvariants =
  | {
      type: "Acyclic";
      payload: {
        // Ensures no cycles in specified edge kinds
        appliesTo: EdgeKind[];
      };
    }
  | {
      type: "Connected";
      payload: {
        // Ensures all nodes are reachable via specified edge kinds
        edgeKinds: EdgeKind[];
        // Optional: root nodes that must be able to reach all others
        rootNodeKinds?: NodeKind[];
      };
    }
  | {
      type: "Containment";
      payload: {
        // Ensures edges of certain kinds only connect specific node types
        source: NodeKind;
        edgeKind: EdgeKind;
        target: NodeKind;
      };
    }
  | {
      type: "DegreeConstraint";
      payload: {
        // Constrains number of edges of a kind connected to a node
        edgeKind: EdgeKind;
        min: number;
        max: number;
        appliesTo: NodeKind[]; // If empty, applies to all nodes
      };
    };

// Runtime type guards moved to @hexagen/runtime
// Use isAcyclicInvariant(), isConnectedInvariant(), isContainmentInvariant(), isDegreeConstraintInvariant() from @hexagen/runtime instead
