import { Button } from "@hexagen/ui";
import { Plus, Download, Undo2, Redo2, RefreshCw, Loader2 } from "lucide-react";

export interface CanvasToolbarProps {
  onAddNode?: () => void;
  onExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCleanup?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isCalculating?: boolean;
}

export function CanvasToolbar({
  onAddNode,
  onExport,
  onUndo,
  onRedo,
  onCleanup,
  canUndo = false,
  canRedo = false,
  isCalculating = false,
}: CanvasToolbarProps) {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-border bg-background">
      <Button size="sm" onClick={onAddNode} disabled={isCalculating}>
        <Plus className="h-4 w-4 mr-1" />
        Add Node
      </Button>

      <div className="h-6 w-px bg-border mx-1" />

      <Button
        size="sm"
        variant="outline"
        onClick={onUndo}
        disabled={!canUndo || isCalculating}
        aria-label="Undo"
        title="Undo last change"
      >
        <Undo2 className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={onRedo}
        disabled={!canRedo || isCalculating}
        aria-label="Redo"
        title="Redo last change"
      >
        <Redo2 className="h-4 w-4" />
      </Button>

      <div className="h-6 w-px bg-border mx-1" />

      <Button
        size="sm"
        variant="outline"
        onClick={onCleanup}
        disabled={isCalculating}
        title="Recalculate layout (clears manual positioning)"
      >
        {isCalculating ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-1" />
        )}
        Clean-up
      </Button>

      <div className="flex-1" />

      {isCalculating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Calculating layout...</span>
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onExport}
        disabled={isCalculating}
      >
        <Download className="h-4 w-4 mr-1" />
        Export
      </Button>
    </div>
  );
}

// Made with Bob
