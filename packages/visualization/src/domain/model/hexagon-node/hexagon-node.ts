export type HexagonNodeType =
  | "bounded-context"
  | "entity"
  | "port"
  | "use-case";

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
