"use client";

import { useState, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { ResponsiveTabs, type TabPanel } from "./ResponsiveTabs";
import { useBreakpoint } from "@/hooks/useBreakpoint";

interface ResizableLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
}

interface PanelHeaderProps {
  title: string;
  side: "left" | "right";
  onCollapse: () => void;
}

function PanelHeader({ title, side, onCollapse }: PanelHeaderProps) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
      <span className="font-semibold text-sm truncate">{title}</span>
      <button
        onClick={onCollapse}
        aria-label={`Collapse ${title}`}
        className="p-1 hover:bg-muted rounded transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

interface CollapsedStripProps {
  side: "left" | "right";
  onExpand: () => void;
}

function CollapsedStrip({ side, onExpand }: CollapsedStripProps) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  return (
    <div className="flex items-start justify-center w-8 shrink-0 border border-border rounded-lg bg-card pt-2">
      <button
        onClick={onExpand}
        aria-label={`Expand ${side} panel`}
        className="p-1 hover:bg-muted rounded transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function DesktopLayout({ left, middle, right }: ResizableLayoutProps) {
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const collapseLeft = () => leftPanelRef.current?.collapse();
  const expandLeft = () => leftPanelRef.current?.resize(25);
  const collapseRight = () => rightPanelRef.current?.collapse();
  const expandRight = () => rightPanelRef.current?.resize(25);

  return (
    <div className="hidden lg:flex h-full gap-2">
      {leftCollapsed && <CollapsedStrip side="left" onExpand={expandLeft} />}

      <PanelGroup direction="horizontal" className="flex-1 h-full">
        {/* Left Sidebar - Wizard */}
        <Panel
          ref={leftPanelRef}
          id="left"
          defaultSize={25}
          minSize={15}
          maxSize={35}
          collapsible
          collapsedSize={0}
          onCollapse={() => setLeftCollapsed(true)}
          onExpand={() => setLeftCollapsed(false)}
        >
          <Card className="h-full overflow-hidden border border-border rounded-lg">
            <PanelHeader
              title="HexaGen Project Wizard"
              side="left"
              onCollapse={collapseLeft}
            />
            <CardContent className="p-0 h-[calc(100%-40px)] overflow-auto">
              {left}
            </CardContent>
          </Card>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-blue transition-colors cursor-col-resize p-2" />

        {/* Middle Pane - Main Content / Preview */}
        <Panel defaultSize={50} minSize={30}>
          <Card className="h-full overflow-hidden border border-border rounded-lg">
            {middle}
          </Card>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-blue transition-colors cursor-col-resize p-2" />

        {/* Right Sidebar - AI / Monaco */}
        <Panel
          ref={rightPanelRef}
          id="right"
          defaultSize={25}
          minSize={15}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onCollapse={() => setRightCollapsed(true)}
          onExpand={() => setRightCollapsed(false)}
        >
          <Card className="h-full overflow-hidden border border-border rounded-lg">
            <PanelHeader
              title="Monaco AI Architect"
              side="right"
              onCollapse={collapseRight}
            />
            <CardContent className="p-0 h-[calc(100%-40px)] overflow-hidden">
              {right}
            </CardContent>
          </Card>
        </Panel>
      </PanelGroup>

      {rightCollapsed && (
        <CollapsedStrip side="right" onExpand={expandRight} />
      )}
    </div>
  );
}

function MobileLayout({ left, middle, right }: ResizableLayoutProps) {
  const panels: TabPanel[] = [
    {
      id: "wizard",
      title: "Wizard",
      icon: "wizard",
      content: (
        <div className="h-full overflow-auto">
          {left}
        </div>
      ),
    },
    {
      id: "preview",
      title: "Preview",
      icon: "preview",
      content: (
        <div className="h-full overflow-hidden">
          {middle}
        </div>
      ),
    },
    {
      id: "ai",
      title: "AI Architect",
      icon: "ai",
      content: (
        <div className="h-full overflow-hidden">
          {right}
        </div>
      ),
    },
  ];

  return (
    <div className="flex lg:hidden h-full">
      <ResponsiveTabs panels={panels} />
    </div>
  );
}

export function ResizableLayout(props: ResizableLayoutProps) {
  const breakpoint = useBreakpoint();

  return (
    <div className="h-screen w-full overflow-hidden p-5 bg-background">
      <DesktopLayout {...props} />
      <MobileLayout {...props} />
    </div>
  );
}
