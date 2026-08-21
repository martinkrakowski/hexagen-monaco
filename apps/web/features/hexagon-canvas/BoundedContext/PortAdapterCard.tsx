"use client";

import { PortAdapterHandles } from "./PortAdapterHandles";
import { AddOnBadge } from "../AddOnBadge";
import {
  addOnHoverText,
  ADDON_RING_STYLE,
} from "../addon-overlay-presentation";
import type { AddOnNodeMeta } from "../addon-overlay-nodes";
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
  const addOn = (data as { addOn?: AddOnNodeMeta }).addOn;

  return (
    <div
      style={
        addOn
          ? { width: 140, height: 72, ...ADDON_RING_STYLE }
          : { width: 140, height: 72 }
      }
      title={addOn ? addOnHoverText(addOn) : undefined}
      className={`relative flex flex-col rounded-lg border overflow-hidden transition-colors select-none ${variant.bodyBg} ${variant.border} ${selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : ""}`}
    >
      {addOn ? (
        <AddOnBadge className="absolute right-1 top-1 z-20 shadow-sm" />
      ) : null}
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
      <PortAdapterHandles variant={variant} side={data.side} />
    </div>
  );
}
