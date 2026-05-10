"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PanelHeaderProps {
  title: string;
  side: "left" | "right";
  isCollapsed: boolean;
  onCollapse: () => void;
}

export const PanelHeader = React.memo(function PanelHeader({
  title,
  side,
  isCollapsed,
  onCollapse,
}: PanelHeaderProps) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/30 shrink-0 h-12">
      <span className="font-semibold text-sm truncate">{title}</span>
      <button
        type="button"
        onClick={onCollapse}
        aria-label={`Collapse ${title}`}
        aria-expanded={!isCollapsed}
        className="p-1.5 hover:bg-muted rounded transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
});
