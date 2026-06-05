"use client";

import { AddOnBadge } from "./AddOnBadge";
import {
  addOnChipVisual,
  ADDON_RING_STYLE,
} from "./addon-overlay-presentation";

// Built from the SAME helpers the nodes use, so the legend cannot drift from
// what is actually rendered on the canvas.
const PLATFORM = addOnChipVisual({ kind: "platform-zone", reason: "project" });
const SHARED = addOnChipVisual({ kind: "shared-kernel" });
const NO_HOST = addOnChipVisual({ kind: "platform-zone", reason: "no-host" });

function ChipSwatch({
  visual,
}: {
  visual: { className: string; style: React.CSSProperties };
}) {
  return (
    <span
      className={`inline-block h-4 w-7 rounded-full ${visual.className}`}
      style={visual.style}
    />
  );
}

/**
 * Add-on overlay legend (bottom-left, above the zoom controls). Each swatch is
 * rendered with the exact node style helpers (addOnChipVisual / ADDON_RING_STYLE
 * / AddOnBadge) — no separate legend styles to drift.
 */
export function AddOnLegend() {
  return (
    <div className="pointer-events-none select-none rounded-lg border border-border bg-card/95 p-2.5 text-xs shadow-md">
      <div className="mb-1.5 font-semibold text-foreground">Add-on overlay</div>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <span
            className="relative inline-flex h-5 w-8 items-center justify-center rounded-md border border-border bg-card"
            style={ADDON_RING_STYLE}
          >
            <AddOnBadge className="absolute -right-1 -top-1" />
          </span>
          <span className="text-muted-foreground">add-on-provided adapter</span>
        </li>
        <li className="flex items-center gap-2">
          <ChipSwatch visual={PLATFORM} />
          <span className="text-muted-foreground">platform add-on</span>
        </li>
        <li className="flex items-center gap-2">
          <ChipSwatch visual={SHARED} />
          <span className="text-muted-foreground">shared-kernel add-on</span>
        </li>
        <li className="flex items-center gap-2">
          <ChipSwatch visual={NO_HOST} />
          <span className="text-muted-foreground">selected · no host</span>
        </li>
      </ul>
    </div>
  );
}
