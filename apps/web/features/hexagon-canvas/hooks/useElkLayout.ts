import { useCallback, useRef } from "react";
import type {
  RenderableHexagonNode,
  RenderableHexagonEdge,
} from "@hexagen/visualization";
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
      nodes: RenderableHexagonNode[],
      edges: RenderableHexagonEdge[],
      direction: "RIGHT" | "DOWN" | "LEFT" | "UP" = "RIGHT",
    ): Promise<LayoutResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 10));

      try {
        // Three casts used to stand here — `node as HexagonNode & { parentId
        // … }` plus one per `style` read — because `parentId` / `side` / `style`
        // were reachable only through a type this hook's parameter did not
        // name. Naming `RenderableHexagonNode` removed all three (HEX-030).
        const layoutNodes: LayoutNode[] = nodes.map((node) => ({
          id: node.id,
          width: node.style?.width ?? 180,
          height: node.style?.height ?? 100,
          parentId: node.parentId,
          type: node.type,
          side: node.side,
        }));

        const layoutEdges: LayoutEdge[] = edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        }));

        const graphDirection =
          direction === "RIGHT" || direction === "LEFT" ? "LR" : "TB";

        const result = await useCaseRef.current.execute(
          layoutNodes,
          layoutEdges,
          graphDirection,
        );

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
