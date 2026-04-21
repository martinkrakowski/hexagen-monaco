"use client";

import { Panel, PanelGroup } from "react-resizable-panels";

import { Card, CardContent } from "@hexagen/ui";
import type { UsePanelCollapseReturn } from "../hooks/usePanelCollapse";

import { PanelHeader } from "./PanelHeader";
import { CollapsedStrip } from "./CollapsedStrip";
import { VerticalResizeHandle } from "./VerticalResizeHandle";
import {
  LEFT_PANEL_SIZES,
  MIDDLE_PANEL_SIZES,
  RIGHT_PANEL_SIZES,
  LAYOUT_AUTO_SAVE_ID,
} from "./constants";

export interface DesktopLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  leftTitle: string;
  rightTitle: string;
  leftCollapse: UsePanelCollapseReturn;
  rightCollapse: UsePanelCollapseReturn;
}

/**
 * Three-panel horizontal layout for large viewports. Left and right
 * panels are collapsible; the middle pane holds the primary content.
 * Panel sizes persist across reloads via LAYOUT_AUTO_SAVE_ID.
 */
export function DesktopLayout({
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
