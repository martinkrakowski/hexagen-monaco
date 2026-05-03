"use client";

import { useCallback } from "react";
import { type IsValidConnection } from "@xyflow/react";
import type {
  HexagonNode as HexagonNodeData,
  HexagonNodeWithLayout,
} from "@hexagen/visualization";

export function useCanvasValidation(
  nodes: HexagonNodeData[],
): IsValidConnection {
  return useCallback(
    (connection): boolean => {
      const sourceHandle = (connection.sourceHandle ?? "") as string;
      const targetHandle = (connection.targetHandle ?? "") as string;

      const isSourceEvent = sourceHandle.startsWith("pub_");
      const isTargetEvent = targetHandle.startsWith("sub_");
      if (isSourceEvent || isTargetEvent) {
        return isSourceEvent && isTargetEvent;
      }

      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.id === "root-core") {
        const sourceNode = nodes.find((n) => n.id === connection.source) as
          | HexagonNodeWithLayout
          | undefined;
        const sourceSide = sourceNode?.side;
        return !sourceSide || sourceSide === targetHandle;
      }

      return true;
    },
    [nodes],
  );
}
