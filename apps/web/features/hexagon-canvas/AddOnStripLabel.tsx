"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

/**
 * The small muted "Platform add-ons" label, left-aligned above the first chip
 * (a canvas node, so it pans/zooms with the strip). Not a legend entry.
 */
function AddOnStripLabelImpl({ data }: NodeProps) {
  return (
    <div className="select-none text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
      {String((data as { label?: string }).label ?? "Platform add-ons")}
    </div>
  );
}

export const AddOnStripLabel = memo(AddOnStripLabelImpl);
