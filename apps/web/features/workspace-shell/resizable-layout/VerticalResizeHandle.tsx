"use client";

import { PanelResizeHandle } from "react-resizable-panels";
import { GripVertical } from "lucide-react";

/**
 * Vertical drag handle between two horizontal panels in the desktop
 * layout. The library handles the drag logic; this is pure visual.
 */
export function VerticalResizeHandle() {
  return (
    <PanelResizeHandle className="w-3 bg-background hover:bg-accent transition-colors cursor-col-resize flex items-center justify-center">
      <GripVertical className="h-4 w-4 text-muted-foreground/50" />
    </PanelResizeHandle>
  );
}
