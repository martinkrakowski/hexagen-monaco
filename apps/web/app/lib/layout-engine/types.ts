import type { HexagonNode } from "@hexagen/visualization";

/**
 * Extended hexagon node with layout-specific metadata that the
 * visualization package's base `HexagonNode` doesn't carry.
 *
 *   parentId / extent — used by ReactFlow to nest children inside
 *                       a parent group and constrain dragging
 *   isRoot / isPeer  — visual category flags; distinguish the
 *                       primary context from satellites and peers
 *   side             — adapter/port placement (north/south for
 *                       adapters; west/east for driving/driven ports)
 *   stats            — counts shown in the hexagon's summary card
 *                       (aggregates/value-objects/events/services)
 */
export interface HexagonNodeWithLayout extends HexagonNode {
  parentId?: string;
  extent?: "parent";
  isRoot?: boolean;
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  draggable?: boolean;
  category?: string;
  style?: { width?: number; height?: number; zIndex?: number };
  stats?: {
    aggregates: number;
    aggregateItems: string[];
    valueObjects: number;
    valueObjectItems: string[];
    events: number;
    eventItems: string[];
    services: number;
    serviceItems: string[];
  };
}
