/**
 * CardinalityInvariants - MVK v1
 * 
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

import { NodeKind } from "./node-kind";

/**
 * CardinalityInvariants - Type-level invariants that enforce quantity constraints on the DomainAST
 */
export type CardinalityInvariants =
  | {
      type: "Exactly";
      payload: {
        // Exactly N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "AtLeast";
      payload: {
        // At least N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "AtMost";
      payload: {
        // At most N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "Between";
      payload: {
        // Between min and max instances (inclusive) of node kind must exist
        nodeKind: NodeKind;
        min: number;
        max: number;
      }
    };

/**
 * Type guard for Exactly invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is an Exactly invariant
 */
export function isExactlyInvariant(invariant: CardinalityInvariants): invariant is Extract<CardinalityInvariants, { type: "Exactly" }> {
  return invariant.type === "Exactly";
}

/**
 * Type guard for AtLeast invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is an AtLeast invariant
 */
export function isAtLeastInvariant(invariant: CardinalityInvariants): invariant is Extract<CardinalityInvariants, { type: "AtLeast" }> {
  return invariant.type === "AtLeast";
}

/**
 * Type guard for AtMost invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is an AtMost invariant
 */
export function isAtMostInvariant(invariant: CardinalityInvariants): invariant is Extract<CardinalityInvariants, { type: "AtMost" }> {
  return invariant.type === "AtMost";
}

/**
 * Type guard for Between invariant
 * @param invariant - Invariant to check
 * @returns true if invariant is a Between invariant
 */
export function isBetweenInvariant(invariant: CardinalityInvariants): invariant is Extract<CardinalityInvariants, { type: "Between" }> {
  return invariant.type === "Between";
}