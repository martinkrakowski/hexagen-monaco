"use client";

import { PortAdapterHandles } from "./PortAdapterHandles";
import type { BoundedContextData, NodeVariant } from "./types";

interface PortAdapterCardProps {
  data: BoundedContextData;
  variant: NodeVariant;
  selected: boolean;
}

export function PortAdapterCard({
  data,
  variant,
  selected,
}: PortAdapterCardProps) {
  return (
    <div
      style={{ width: 140, height: 72 }}
      className={`relative rounded-lg border overflow-hidden transition-colors select-none ${variant.bodyBg} ${variant.border} ${selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : ""}`}
    >
      <div
        className={`h-7 ${variant.headerBg} flex items-center justify-center ${variant.headerText} text-xs font-semibold truncate px-2`}
      >
        {data.compilerCategory
          ? String(data.compilerCategory).replace(/-/g, " ").toUpperCase()
          : null}
      </div>
      <div className="h-[calc(100%-28px)] flex items-center justify-center px-2">
        <span className="text-xs font-medium text-foreground text-center truncate">
          {String(data.label || "")}
        </span>
      </div>
      <PortAdapterHandles variant={variant} side={data.side} />
    </div>
  );
}
