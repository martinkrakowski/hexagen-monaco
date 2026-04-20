import { Button } from "@hexagen/ui";
import { Plus, ZoomIn, ZoomOut, Download } from "lucide-react";

export interface CanvasToolbarProps {
  onAddNode?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onExport?: () => void;
}

export function CanvasToolbar({
  onAddNode,
  onZoomIn,
  onZoomOut,
  onExport,
}: CanvasToolbarProps) {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-border bg-background">
      <Button size="sm" onClick={onAddNode}>
        <Plus className="h-4 w-4 mr-1" />
        Add Node
      </Button>
      <div className="flex-1" />
      <Button
        size="sm"
        variant="outline"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={onExport}>
        <Download className="h-4 w-4 mr-1" />
        Export
      </Button>
    </div>
  );
}
