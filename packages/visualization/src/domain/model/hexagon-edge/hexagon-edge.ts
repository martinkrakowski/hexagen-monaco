export type EdgeType = "default" | "animated" | "smoothstep";

export interface HexagonEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export function createHexagonEdge(
  id: string,
  source: string,
  target: string,
  type: EdgeType = "default",
  label?: string,
): HexagonEdge {
  return {
    id,
    source,
    target,
    type,
    label,
  };
}
