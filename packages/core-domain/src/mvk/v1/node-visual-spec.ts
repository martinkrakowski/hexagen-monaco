/**
 * NodeVisualSpec - MVK v1
 * 
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 * 
 * NOTE: This is a stubbed interface representing the boundary between kernel and projection.
 * The actual visual properties are computed by the projection system based on kernel semantics.
 */

import { Identifier } from "./domain-ast";

/**
 * NodeVisualSpec - Visual specification for a node (projection boundary only)
 * 
 * This interface defines what the projection system receives from the kernel.
 * Actual visual rendering properties (position, size, colors) are computed by 
 * the projection system based on semantic meaning and theme.
 */
export interface NodeVisualSpec {
  /** Core identity - links to the DomainAST node */
  nodeId: Identifier;
  
  // NOTE: The following fields are intentionally omitted from the MVK contract
  // as they belong exclusively to the projection system:
  // 
  // Visual properties (computed by projection system):
  // position: { x: number; y: number };
  // size: { width: number; height: number };
  // 
  // Styling (theme-dependent, computed by projection system):
  // style: {
  //   backgroundColor: string; // HSL format
  //   borderColor: string; // HSL format
  //   textColor: string; // HSL format
  // };
  // 
  // Icon metadata (semantic → visual mapping handled by projection):
  // icon: {
  //   name: string; // Logical icon name
  //   color: string; // HSL format
  // };
  // 
  // Label and text content:
  // label: string;
  // tooltip?: string;
  // 
  // Interaction state (projection-only, not part of kernel):
  // interactionState: {
  //   hovered: boolean;
  //   selected: boolean;
  //   dragged: boolean;
  // };
  // 
  // Affordances (computed by projection system based on kernel semantics):
  // affordances: {
  //   movable: boolean;
  //   resizable: boolean;
  //   connectable: boolean;
  //   deletable: boolean;
  // };
}