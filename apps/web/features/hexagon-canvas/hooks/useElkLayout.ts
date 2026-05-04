import { useCallback, useRef } from "react";
import type { HexagonNode, HexagonEdge } from "@hexagen/visualization";
import { getSolveGraphLayoutUseCase } from "@/lib/wire";

export interface LayoutResponse {
  positions: Array<{
    nodeId: string;
    x: number;
    y: number;
  }>;
}

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  type?: string;
  side?: "north" | "south" | "east" | "west";
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export function useElkLayout() {
  const useCaseRef = useRef(getSolveGraphLayoutUseCase());

  const calculateLayout = useCallback(
    async (
      nodes: HexagonNode[],
      edges: HexagonEdge[],
      direction: "RIGHT" | "DOWN" | "LEFT" | "UP" = "RIGHT",
    ): Promise<LayoutResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 10));

      try {
        const layoutNodes: LayoutNode[] = nodes.map((node) => {
          const layoutNode = node as HexagonNode & {
            parentId?: string;
            side?: "north" | "south" | "east" | "west";
          };
          return {
            id: node.id,
            width: (layoutNode as { style?: { width?: number } }).style?.width ?? 180,
            height: (layoutNode as { style?: { height?: number } }).style?.height ?? 100,
            parentId: layoutNode.parentId,
            type: node.type,
            side: layoutNode.side,
          };
        });

        const layoutEdges: LayoutEdge[] = edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        }));

        const graphDirection = direction === "RIGHT" || direction === "LEFT" ? "LR" : "TB";

        const result = await useCaseRef.current.execute(layoutNodes, layoutEdges, graphDirection);

        return { positions: [...result.positions] };
      } catch (error) {
        console.error("ELK layout calculation failed:", error);
        throw new Error(
          `ELK layout failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  return {
    calculateLayout,
  };
}