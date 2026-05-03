"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeVariant } from "./types";

interface PortAdapterHandlesProps {
  variant: NodeVariant;
  side?: "north" | "south" | "west" | "east";
}

export function PortAdapterHandles({ variant, side }: PortAdapterHandlesProps) {
  const showNorth = side === "north";
  const showSouth = side === "south";

  return (
    <>
      {showNorth && (
        <Handle
          type="source"
          position={Position.Top}
          id="north"
          className={`${variant.handleColor} !w-3 !h-3 border-2 border-background`}
        />
      )}
      {showSouth && (
        <Handle
          type="target"
          position={Position.Bottom}
          id="south"
          className={`${variant.handleColor} !w-3 !h-3 border-2 border-background`}
        />
      )}
      {!showNorth && !showSouth && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="west"
            className={`${variant.handleColor} !w-3 !h-3 border-2 border-background`}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="east"
            className={`${variant.handleColor} !w-3 !h-3 border-2 border-background`}
          />
        </>
      )}
    </>
  );
}
