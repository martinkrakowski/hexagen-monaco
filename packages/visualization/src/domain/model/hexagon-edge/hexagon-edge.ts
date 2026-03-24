export type EdgeType =
  | "default"
  | "animated"
  | "smoothstep"
  | "step"
  | "straight"
  | "bezier";

export interface HexagonEdge {
  id: string;
  source: string;
  target: string;
  type?: EdgeType;
  label?: string;
  animated?: boolean;
  sourceHandle?: string;
  targetHandle?: string;
  markerEnd?: string;
  style?: Record<string, string>;
  className?: string;
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
