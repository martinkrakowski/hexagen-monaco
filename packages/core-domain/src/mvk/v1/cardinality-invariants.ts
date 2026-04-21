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
      };
    }
  | {
      type: "AtLeast";
      payload: {
        // At least N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      };
    }
  | {
      type: "AtMost";
      payload: {
        // At most N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      };
    }
  | {
      type: "Between";
      payload: {
        // Between min and max instances (inclusive) of node kind must exist
        nodeKind: NodeKind;
        min: number;
        max: number;
      };
    };

// Runtime type guards moved to @hexagen/runtime
// Use isExactlyInvariant(), isAtLeastInvariant(), isAtMostInvariant(), isBetweenInvariant() from @hexagen/runtime instead
