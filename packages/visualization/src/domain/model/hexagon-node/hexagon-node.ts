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

/**
 * A node plus the graph annotations a *layout* needs — containment, compass
 * placement, and the DDD classification a renderer keys off.
 *
 * What is deliberately NOT here (HEX-030). This type used to also carry
 * `extent: "parent"`, `draggable`, `style` and a `variant` bag of CSS colour
 * tokens. Each of those is vocabulary owned by React Flow or by CSS: `extent`
 * is React Flow's prop name *and* its literal value, `draggable` is a React
 * Flow node prop, `style` is a CSS box, and `variant` held Tailwind class
 * strings and `#rrggbb` literals. None of them survives swapping the renderer,
 * which is the test this file applies. They now live in
 * `application/ports/in/renderable-graph.ts` as `HexagonNodePresentation`, and
 * a compile-time witness there fails the build if any of them comes back.
 *
 * What stays, and why:
 *  - `parentId` — containment. A nested graph is still nested in Graphviz.
 *  - `isRoot` / `isPeer` — DDD classification of the context itself.
 *  - `side` — the hexagonal compass (north = primary adapter, …). This repo's
 *    own architectural vocabulary; the renderer merely honours it.
 *  - `category` / `compilerCategory` — `primary-adapter` / `secondary-port`.
 *    Hexagonal-architecture terms, not style names.
 *  - `stats` — counts of aggregates, value objects, events and services.
 *
 * `position` stays on {@link HexagonNode} for the same reason: it is a graph
 * coordinate produced by ELK, persisted, and mutated by drag. It is geometry,
 * not styling, and the finding's own recommendation keeps it.
 */
export interface HexagonNodeWithLayout extends HexagonNode {
  parentId?: string;
  isRoot?: boolean;
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  category?: string;
  compilerCategory?: string;
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
