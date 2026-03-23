"use client";

import { memo } from "react";
import { UnifiedBoundedContext } from "./BoundedContext";
import type { NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";

interface HexagonData extends Record<string, unknown> {
  label: string;
  type?:
    | "bounded-context"
    | "entity"
    | "port"
    | "use-case"
    | "adapter"
    | "inner";
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  category?: string;
  stats?: {
    aggregates?: number;
    aggregateItems?: string[];
    valueObjects?: number;
    valueObjectItems?: string[];
    events?: number;
    eventItems?: string[];
    services?: number;
    serviceItems?: string[];
  };
  publishedEvents: Array<{ id: string; label: string }>; // DomainEventRef[]
  subscribedEvents: Array<{ id: string; label: string }>; // DomainEventRef[]
  parentId?: string;
}

function HexagonNodeComponent({
  data,
  selected,
}: NodeProps<Node<HexagonData>>) {
  return <UnifiedBoundedContext data={data} selected={selected} />;
}

const HexagonNode = memo(HexagonNodeComponent);

HexagonNode.displayName = "HexagonNode";

export { HexagonNode };
export type { HexagonData };
