/**
 * Runtime type guards for cardinality invariants
 * Moved from MVK layer to maintain IR-clean boundary
 */

import { CardinalityInvariants } from "@hexagen/core-domain";

export function isExactlyInvariant(
  invariant: CardinalityInvariants,
): invariant is Extract<CardinalityInvariants, { type: "Exactly" }> {
  return invariant.type === "Exactly";
}

export function isAtLeastInvariant(
  invariant: CardinalityInvariants,
): invariant is Extract<CardinalityInvariants, { type: "AtLeast" }> {
  return invariant.type === "AtLeast";
}

export function isAtMostInvariant(
  invariant: CardinalityInvariants,
): invariant is Extract<CardinalityInvariants, { type: "AtMost" }> {
  return invariant.type === "AtMost";
}

export function isBetweenInvariant(
  invariant: CardinalityInvariants,
): invariant is Extract<CardinalityInvariants, { type: "Between" }> {
  return invariant.type === "Between";
}
