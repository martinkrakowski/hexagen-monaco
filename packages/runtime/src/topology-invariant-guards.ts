/**
 * Runtime type guards for topology invariants
 * Moved from MVK layer to maintain IR-clean boundary
 */

import { TopologyInvariants } from "@hexagen/core-domain";

export function isAcyclicInvariant(
  invariant: TopologyInvariants,
): invariant is Extract<TopologyInvariants, { type: "Acyclic" }> {
  return invariant.type === "Acyclic";
}

export function isConnectedInvariant(
  invariant: TopologyInvariants,
): invariant is Extract<TopologyInvariants, { type: "Connected" }> {
  return invariant.type === "Connected";
}

export function isContainmentInvariant(
  invariant: TopologyInvariants,
): invariant is Extract<TopologyInvariants, { type: "Containment" }> {
  return invariant.type === "Containment";
}

export function isDegreeConstraintInvariant(
  invariant: TopologyInvariants,
): invariant is Extract<TopologyInvariants, { type: "DegreeConstraint" }> {
  return invariant.type === "DegreeConstraint";
}
