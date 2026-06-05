"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { AddOnBadge } from "./AddOnBadge";
import {
  addOnChipVisual,
  addOnHoverText,
  addOnName,
} from "./addon-overlay-presentation";
import type { AddOnNodeMeta } from "./addon-overlay-nodes";

/**
 * A platform / shared-kernel add-on chip in the strip below the diagram. Style
 * (solid accent · violet · muted-dashed) comes from {@link addOnChipVisual}; the
 * ⊕ marker and hover attribution are shared with the compass annotation.
 */
function AddOnChipNodeImpl({ data }: NodeProps) {
  const addOn = (data as { addOn?: AddOnNodeMeta }).addOn;
  if (!addOn) return null;
  const visual = addOnChipVisual(addOn);
  return (
    <div
      title={addOnHoverText(addOn)}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium select-none ${visual.className}`}
      style={visual.style}
    >
      <AddOnBadge />
      <span className="truncate text-foreground">
        {addOnName(addOn.addOnId)}
      </span>
    </div>
  );
}

export const AddOnChipNode = memo(AddOnChipNodeImpl);
