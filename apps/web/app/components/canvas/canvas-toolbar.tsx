import { PrimaryButton } from "@/components/ui/PrimaryButton";
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
      <PrimaryButton size="sm" onClick={onAddNode}>
        <Plus className="h-4 w-4 mr-1" />
        Add Node
      </PrimaryButton>
      <div className="flex-1" />
      <PrimaryButton size="sm" variant="outline" onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" />
      </PrimaryButton>
      <PrimaryButton size="sm" variant="outline" onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" />
      </PrimaryButton>
      <PrimaryButton size="sm" variant="outline" onClick={onExport}>
        <Download className="h-4 w-4 mr-1" />
        Export
      </PrimaryButton>
    </div>
  );
}
