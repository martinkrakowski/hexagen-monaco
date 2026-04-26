/**
 * NodeVisualSpec - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 *
 * NOTE: This is a stubbed interface representing the boundary between kernel and projection.
 * The actual visual properties are computed by the projection system based on kernel semantics.
 */

import { Identifier } from "./domain-ast.js";
import { NodeKind } from "./node-kind.js";

export interface NodeVisualSpec {
  nodeId: Identifier;
  kind: NodeKind;
  label: string;
  category?: string;
}
