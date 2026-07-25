"use client";

import React from "react";

import { useBreakpoint } from "../hooks/useBreakpoint";
import { usePanelCollapse } from "../hooks/usePanelCollapse";
import { ResponsiveTabs, type TabPanel } from "../ResponsiveTabs";

import { TwoPaneDesktopLayout } from "./TwoPaneDesktopLayout";
import { TWO_PANE_LEFT_SIZES } from "./constants";

export interface TwoPaneLayoutProps {
  /** Left column content — the form/sources column. */
  left: React.ReactNode;
  /** Right column content — the primary work area (owns its own chrome). */
  right: React.ReactNode;
  /** Title above the left column (desktop header + left tab label). */
  leftTitle: string;
  /** Label for the right tab on mobile (the desktop right pane has no header). */
  rightTitle: string;
  /** Pinned to the bottom of the left column (e.g. "Add planning session"). */
  leftFooter?: React.ReactNode;
  /** Called when the left column collapses on desktop (e.g. clear a URL param). */
  onLeftPanelClose?: () => void;
}

/**
 * Public entry for the two-pane plan workbench. Chooses between the collapsible
 * desktop layout and the tab-based mobile layout by viewport, mirroring
 * {@link ResizableLayout}. Fills its parent (`h-full`); the host owns page
 * padding and background.
 */
export const TwoPaneLayout = React.memo(function TwoPaneLayout({
  left,
  right,
  leftTitle,
  rightTitle,
  leftFooter,
  onLeftPanelClose,
}: TwoPaneLayoutProps) {
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === "lg";

  const leftCollapse = usePanelCollapse({
    defaultExpandedSize: TWO_PANE_LEFT_SIZES.defaultSize,
    onClose: onLeftPanelClose,
  });

  if (isDesktop) {
    return (
      <TwoPaneDesktopLayout
        left={left}
        right={right}
        leftTitle={leftTitle}
        leftFooter={leftFooter}
        leftCollapse={leftCollapse}
      />
    );
  }

  const panels: TabPanel[] = [
    {
      id: "form",
      title: leftTitle,
      icon: "wizard",
      content: <div className="h-full overflow-auto">{left}</div>,
    },
    {
      id: "main",
      title: rightTitle,
      icon: "ai",
      content: <div className="h-full overflow-hidden">{right}</div>,
    },
  ];

  // The footer sits BELOW both tabs (locked decision §5 Q6), not inside the
  // form tab: "Add planning session" must stay reachable while the session
  // tab is active, and ResponsiveTabs unmounts inactive tab content.
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 flex">
        <ResponsiveTabs panels={panels} />
      </div>
      {leftFooter && (
        <div className="border-t border-border p-3 shrink-0">{leftFooter}</div>
      )}
    </div>
  );
});
