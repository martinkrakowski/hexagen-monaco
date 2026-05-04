"use client";

import { Handle, Position } from "@xyflow/react";
import { EventHandles } from "./EventHandles";
import type { BoundedContextData } from "./types";

interface HexagonHandlesProps {
  data: BoundedContextData;
  structuralHandle: string;
  publishedHandle: string;
  subscribedHandle: string;
}

export function HexagonHandles({
  data,
  structuralHandle,
  publishedHandle,
  subscribedHandle,
}: HexagonHandlesProps) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        id="north"
        className={`${structuralHandle} !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="south"
        className={`${structuralHandle} !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]`}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="west"
        className={`${structuralHandle} !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="east"
        className={`${structuralHandle} !w-3 !h-3 border-2 border-background`}
      />
      <EventHandles
        publishedEvents={data.publishedEvents}
        subscribedEvents={data.subscribedEvents}
        publishedHandle={publishedHandle}
        subscribedHandle={subscribedHandle}
      />
    </>
  );
}
