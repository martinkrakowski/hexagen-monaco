"use client";

import React from "react";
import { PanelResizeHandle } from "react-resizable-panels";

/**
 * Subtle right-edge resize handle for the manifest YAML column: a thin strip on
 * the panel boundary — transparent at rest, highlighting on hover/drag with a
 * col-resize cursor. Mirrors the workspace shell's VerticalResizeHandle but
 * thinner and icon-less, so it reads as "drag the column's right edge" rather
 * than a divider. Keyboard-resizable (PanelResizeHandle is a focusable
 * role="separator") with a focus-visible ring per DESIGN.md §4.8.
 */
export const ManifestResizeHandle = React.memo(function ManifestResizeHandle() {
  return (
    <PanelResizeHandle
      aria-label="Resize manifest column"
      className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  );
});
