export type HexagonNodeType =
  | "bounded-context"
  | "entity"
  | "port"
  | "use-case"
  | "adapter"
  | "peer"
  | "group";

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
