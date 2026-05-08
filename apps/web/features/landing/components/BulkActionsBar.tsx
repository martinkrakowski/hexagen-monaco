"use client";

import { Button } from "@hexagen/ui";

interface BulkActionsBarProps {
  selectedCount: number;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onDeleteSelected,
  onClearSelection,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 bg-muted/80 rounded-lg border border-border mt-4"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>
      <div className="flex gap-2 ml-auto">
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>
        <Button variant="destructive" size="sm" onClick={onDeleteSelected}>
          Delete Selected
        </Button>
      </div>
    </div>
  );
}
