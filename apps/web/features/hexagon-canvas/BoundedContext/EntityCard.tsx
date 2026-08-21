"use client";

import { Handle, Position } from "@xyflow/react";
import type { BoundedContextData, NodeVariant } from "./types";

interface EntityCardProps {
  data: BoundedContextData;
  variant: NodeVariant;
  selected: boolean;
}

export function EntityCard({ data, variant, selected }: EntityCardProps) {
  const nodeWidth = 140;
  const nodeHeight = 72;

  return (
    <div
      style={{ width: nodeWidth, height: nodeHeight }}
      className={`relative flex flex-col rounded-lg border overflow-hidden transition-colors select-none ${variant.bodyBg} ${variant.border} ${selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : ""}`}
    >
      <div
        className={`h-7 shrink-0 ${variant.headerBg} flex items-center justify-center ${variant.headerText} text-xs font-semibold truncate px-2`}
      >
        {data.compilerCategory
          ? String(data.compilerCategory).replace(/-/g, " ").toUpperCase()
          : null}
      </div>
      {/* Fills the space left by the h-7 (28px) header. Was
          `h-[calc(100%-28px)]` — a hard-coded restatement of the header
          height, and an arbitrary value DESIGN.md §4.8 forbids. */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2">
        <span className="text-xs font-medium text-foreground text-center truncate">
          {String(data.label || "")}
        </span>
      </div>
      <Handle
        type="target"
        position={Position.Top}
        id="north"
        className={`${variant.handleColor} !w-2.5 !h-2.5`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="south"
        className={`${variant.handleColor} !w-2.5 !h-2.5`}
      />
    </div>
  );
}
