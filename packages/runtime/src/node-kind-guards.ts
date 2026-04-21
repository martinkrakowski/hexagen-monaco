/**
 * Runtime type guard for NodeKind
 * Moved from MVK layer to maintain IR-clean boundary
 */

import { NodeKind } from "@hexagen/core-domain";

export function isNodeKind(value: unknown): value is NodeKind {
  return (
    typeof value === "string" &&
    Object.values(NodeKind).includes(value as NodeKind)
  );
}
