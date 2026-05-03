"use client";

import { Handle, Position } from "@xyflow/react";
import { getSlottedOffsets } from "./lib/utils";
import type { DomainEventRef } from "@hexagen/project-configuration";

interface EventHandlesProps {
  publishedEvents?: DomainEventRef[];
  subscribedEvents?: DomainEventRef[];
  publishedHandle: string;
  subscribedHandle: string;
}

export function EventHandles({
  publishedEvents,
  subscribedEvents,
  publishedHandle,
  subscribedHandle,
}: EventHandlesProps) {
  return (
    <>
      {(publishedEvents ?? []).slice(0, 5).map((evt, i) => (
        <Handle
          key={evt.id}
          type="source"
          position={Position.Right}
          id={evt.id}
          style={{
            top: getSlottedOffsets((publishedEvents ?? []).length)[i],
          }}
          className={`${publishedHandle} !w-2.5 !h-2.5 !border !border-background !rounded-sm`}
          title={`Publishes: ${evt.label}`}
        />
      ))}
      {(subscribedEvents ?? []).slice(0, 5).map((evt, i) => (
        <Handle
          key={evt.id}
          type="target"
          position={Position.Left}
          id={evt.id}
          style={{
            top: getSlottedOffsets((subscribedEvents ?? []).length)[i],
          }}
          className={`${subscribedHandle} !w-2.5 !h-2.5 !border !border-background !rounded-sm`}
          title={`Subscribes to: ${evt.label}`}
        />
      ))}
    </>
  );
}
