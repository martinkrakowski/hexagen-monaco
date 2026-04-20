"use client";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";

import { Card, CardContent } from "@/components/ui/Card";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import {
  usePanelCollapse,
  type UsePanelCollapseReturn,
} from "@/hooks/usePanelCollapse";
import { ResponsiveTabs, type TabPanel } from "./ResponsiveTabs";
import {
  LEFT_PANEL_SIZES,
  MIDDLE_PANEL_SIZES,
  RIGHT_PANEL_SIZES,
  LAYOUT_AUTO_SAVE_ID,
} from "./resizable-layout-constants";

interface ResizableLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** Title rendered above the left panel. Content owns the vocabulary. */
  leftTitle: string;
  /** Title rendered above the right panel. */
  rightTitle: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PanelHeaderProps {
  title: string;
  side: "left" | "right";
  isCollapsed: boolean;
  onCollapse: () => void;
}

function PanelHeader({
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
}

interface CollapsedStripProps {
  side: "left" | "right";
  title: string;
  onExpand: () => void;
}

function CollapsedStrip({ side, title, onExpand }: CollapsedStripProps) {
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
}

function VerticalResizeHandle() {
  return (
    <PanelResizeHandle className="w-3 bg-background hover:bg-accent transition-colors cursor-col-resize flex items-center justify-center">
      <GripVertical className="h-4 w-4 text-muted-foreground/50" />
    </PanelResizeHandle>
  );
}

// ---------------------------------------------------------------------------
// Desktop variant
// ---------------------------------------------------------------------------

interface DesktopLayoutProps extends ResizableLayoutProps {
  leftCollapse: UsePanelCollapseReturn;
  rightCollapse: UsePanelCollapseReturn;
}

function DesktopLayout({
  left,
  middle,
  right,
  leftTitle,
  rightTitle,
  leftCollapse,
  rightCollapse,
}: DesktopLayoutProps) {
  return (
    <div className="flex h-full gap-2">
      {leftCollapse.isCollapsed && (
        <CollapsedStrip
          side="left"
          title={leftTitle}
          onExpand={leftCollapse.expand}
        />
      )}

      <PanelGroup
        direction="horizontal"
        autoSaveId={LAYOUT_AUTO_SAVE_ID}
        className="flex-1 h-full"
      >
        <Panel
          ref={leftCollapse.ref}
          id="left"
          order={1}
          defaultSize={LEFT_PANEL_SIZES.defaultSize}
          minSize={LEFT_PANEL_SIZES.minSize}
          maxSize={LEFT_PANEL_SIZES.maxSize}
          collapsible
          collapsedSize={0}
          onCollapse={leftCollapse.onPanelCollapse}
          onExpand={leftCollapse.onPanelExpand}
        >
          <Card className="h-full border border-border rounded-md flex flex-col">
            <PanelHeader
              title={leftTitle}
              side="left"
              isCollapsed={leftCollapse.isCollapsed}
              onCollapse={leftCollapse.collapse}
            />
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
              {left}
            </CardContent>
          </Card>
        </Panel>

        <VerticalResizeHandle />

        <Panel
          id="middle"
          order={2}
          defaultSize={MIDDLE_PANEL_SIZES.defaultSize}
          minSize={MIDDLE_PANEL_SIZES.minSize}
        >
          <Card className="h-full overflow-hidden border border-border rounded-md">
            {middle}
          </Card>
        </Panel>

        <VerticalResizeHandle />

        <Panel
          ref={rightCollapse.ref}
          id="right"
          order={3}
          defaultSize={RIGHT_PANEL_SIZES.defaultSize}
          minSize={RIGHT_PANEL_SIZES.minSize}
          maxSize={RIGHT_PANEL_SIZES.maxSize}
          collapsible
          collapsedSize={0}
          onCollapse={rightCollapse.onPanelCollapse}
          onExpand={rightCollapse.onPanelExpand}
        >
          <Card className="h-full overflow-hidden border border-border rounded-md">
            <PanelHeader
              title={rightTitle}
              side="right"
              isCollapsed={rightCollapse.isCollapsed}
              onCollapse={rightCollapse.collapse}
            />
            <CardContent className="p-0 h-[calc(100%-3rem)] overflow-hidden">
              {right}
            </CardContent>
          </Card>
        </Panel>
      </PanelGroup>

      {rightCollapse.isCollapsed && (
        <CollapsedStrip
          side="right"
          title={rightTitle}
          onExpand={rightCollapse.expand}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile variant
// ---------------------------------------------------------------------------

function MobileLayout({
  left,
  middle,
  right,
  leftTitle,
  rightTitle,
}: ResizableLayoutProps) {
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

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function ResizableLayout(props: ResizableLayoutProps) {
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === "lg";

  // Hooks must run unconditionally, so they're always called regardless
  // of which variant is rendered. Their state only has effect on desktop.
  const leftCollapse = usePanelCollapse({
    defaultExpandedSize: LEFT_PANEL_SIZES.defaultSize,
  });
  const rightCollapse = usePanelCollapse({
    defaultExpandedSize: RIGHT_PANEL_SIZES.defaultSize,
  });

  return (
    <div className="h-screen w-full overflow-hidden p-4 bg-background">
      {isDesktop ? (
        <DesktopLayout
          {...props}
          leftCollapse={leftCollapse}
          rightCollapse={rightCollapse}
        />
      ) : (
        <MobileLayout {...props} />
      )}
    </div>
  );
}
