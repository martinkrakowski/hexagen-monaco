import {
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeTypes,
  type IsValidConnection,
} from "@xyflow/react";
import type {
  HexagonNode as HexagonNodeData,
  HexagonEdge,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";

export interface HexagonCanvasProps {
  nodes: HexagonNodeData[];
  edges: HexagonEdge[];
  onNodeDragStop?: (node: HexagonNodeData) => void;
  onNodeDoubleClick?: (node: HexagonNodeData) => void;
  onExportClick?: (handler: () => Promise<Result<Blob, Error>>) => void;
}

export type HexagonNodeDataRecord = HexagonNodeData & Record<string, unknown>;
export type HexagonFlowNode = FlowNode<HexagonNodeDataRecord>;

export interface CanvasViewportProps {
  nodes: HexagonFlowNode[];
  edges: FlowEdge[];
  nodeTypes: NodeTypes;
  isValidConnection: IsValidConnection;
  onNodeDragStop: (event: React.MouseEvent, node: HexagonFlowNode) => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: HexagonFlowNode) => void;
  colorMode: "light" | "dark";
}
