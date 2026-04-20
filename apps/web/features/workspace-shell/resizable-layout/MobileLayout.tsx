"use client";

import { ResponsiveTabs, type TabPanel } from "../ResponsiveTabs";

export interface MobileLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  leftTitle: string;
  rightTitle: string;
}

/**
 * Tab-based layout for small and medium viewports. The three panes
 * become three tabs since they can't fit side by side.
 */
export function MobileLayout({
  left,
  middle,
  right,
  leftTitle,
  rightTitle,
}: MobileLayoutProps) {
  const panels: TabPanel[] = [
    {
      id: "wizard",
      title: leftTitle,
      icon: "wizard",
      content: <div className="h-full overflow-auto">{left}</div>,
    },
    {
      id: "preview",
      title: "Preview",
      icon: "preview",
      content: <div className="h-full overflow-hidden">{middle}</div>,
    },
    {
      id: "ai",
      title: rightTitle,
      icon: "ai",
      content: <div className="h-full overflow-hidden">{right}</div>,
    },
  ];

  return (
    <div className="flex h-full">
      <ResponsiveTabs panels={panels} />
    </div>
  );
}
