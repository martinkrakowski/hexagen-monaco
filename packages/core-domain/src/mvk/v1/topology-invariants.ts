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
      }
    }
  | {
      type: "Connected";
      payload: {
        // Ensures all nodes are reachable via specified edge kinds
        edgeKinds: EdgeKind[];
        // Optional: root nodes that must be able to reach all others
        rootNodeKinds?: NodeKind[];
      }
    }
  | {
      type: "Containment";
      payload: {
        // Ensures edges of certain kinds only connect specific node types
        source: NodeKind;
        edgeKind: EdgeKind;
        target: NodeKind;
      }
    }
  | {
      type: "DegreeConstraint";
      payload: {
        // Constrains number of edges of a kind connected to a node
        edgeKind: EdgeKind;
        min: number;
        max: number;
        appliesTo: NodeKind[]; // If empty, applies to all nodes
      }
    };

/**
 * Type guard for Acyclic invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is an Acyclic invariant
 */
export function isAcyclicInvariant(invariant: TopologyInvariants): invariant is Extract<TopologyInvariants, { type: "Acyclic" }> {
  return invariant.type === "Acyclic";
}

/**
 * Type guard for Connected invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is a Connected invariant
 */
export function isConnectedInvariant(invariant: TopologyInvariants): invariant is Extract<TopologyInvariants, { type: "Connected" }> {
  return invariant.type === "Connected";
}

/**
 * Type guard for Containment invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is a Containment invariant
 */
export function isContainmentInvariant(invariant: TopologyInvariants): invariant is Extract<TopologyInvariants, { type: "Containment" }> {
  return invariant.type === "Containment";
}

/**
 * Type guard for DegreeConstraint invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is a DegreeConstraint invariant
 */
export function isDegreeConstraintInvariant(invariant: TopologyInvariants): invariant is Extract<TopologyInvariants, { type: "DegreeConstraint" }> {
  return invariant.type === "DegreeConstraint";
}