"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CollapsedStripProps {
  side: "left" | "right";
  title: string;
  onExpand: () => void;
}

export const CollapsedStrip = React.memo(function CollapsedStrip({ side, title, onExpand }: CollapsedStripProps) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  return (
    <div className="flex items-start justify-center w-8 shrink-0 border border-border rounded-md bg-card pt-2">
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${title}`}
        aria-expanded={false}
        className="p-1.5 hover:bg-muted rounded transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
});
