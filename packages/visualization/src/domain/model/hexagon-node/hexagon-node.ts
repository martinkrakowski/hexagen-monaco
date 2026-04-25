export type HexagonNodeType =
  | "bounded-context"
  | "entity"
  | "port"
  | "use-case"
  | "adapter"
  | "peer"
  | "group"
  | "inner";

/**
 * Defines which handle type (if any) a node of a given type may connect to.
 * `null` means the node connects directly to a bounded context (no structural
 * handle intermediary). `"port"` / `"adapter"` indicate the node must route
 * through the corresponding handle on the target bounded context.
 *
 * Not used by the current cardinal-direction routing (SIDE_MAP in layout-engine),
 * but documents valid domain connection rules for future validation logic.
 */
export const CONNECTION_TARGETS: Record<
  HexagonNodeType,
  "port" | "adapter" | null
> = {
  "bounded-context": null,
  entity: null,
  "use-case": null,
  port: "port",
  adapter: "adapter",
  peer: null,
  group: null,
  inner: null,
};

export function getConnectionTargetType(
  type: HexagonNodeType,
): "port" | "adapter" | null {
  return CONNECTION_TARGETS[type];
}

export interface HexagonNode {
  id: string;
  label: string;
  type: HexagonNodeType;
  position: { x: number; y: number };
  boundedContextId?: string;
}

export interface NodeVisualProps {
  readonly headerBg: string;
  readonly bodyBg: string;
  readonly border: string;
  readonly handleColor: string;
  readonly headerText: string;
  readonly hexColor: string;
  readonly structuralHandleColor?: string;
  readonly publishedEventHandleColor?: string;
  readonly subscribedEventHandleColor?: string;
}

export interface HexagonNodeWithLayout extends HexagonNode {
  parentId?: string;
  extent?: "parent";
  isRoot?: boolean;
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  draggable?: boolean;
  category?: string;
  variant?: NodeVisualProps;
  compilerCategory?: string;
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

export function createHexagonNode(
  id: string,
  label: string,
  type: HexagonNodeType,
  position: { x: number; y: number },
  boundedContextId?: string,
): HexagonNode {
  return {
    id,
    label,
    type,
    position,
    boundedContextId,
  };
}

export function updateHexagonNodePosition(
  node: HexagonNode,
  position: { x: number; y: number },
): HexagonNode {
  return {
    ...node,
    position,
  };
}

export function updateHexagonNodeLabel(
  node: HexagonNode,
  label: string,
): HexagonNode {
  return {
    ...node,
    label,
  };
}

export function createDefaultHexagonNode(
  type: HexagonNodeType = "entity",
  label: string = "New Node",
  position: { x: number; y: number } = { x: 100, y: 100 },
): HexagonNodeWithLayout {
  return {
    id:
      crypto.randomUUID?.() ??
      `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    label,
    type,
    position,
  };
}
