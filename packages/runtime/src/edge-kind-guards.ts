/**
 * Runtime type guards and lookup for EdgeKind
 * Moved from MVK layer to maintain IR-clean boundary
 */

import {
  EdgeKind,
  EDGE_DIRECTIONALITY,
  EdgeDirectionality,
} from "@hexagen/core-domain";

export function isEdgeKind(value: unknown): value is EdgeKind {
  return (
    typeof value === "string" &&
    Object.values(EdgeKind).includes(value as EdgeKind)
  );
}

export function getEdgeDirectionality(kind: EdgeKind): EdgeDirectionality {
  return EDGE_DIRECTIONALITY[kind];
}
