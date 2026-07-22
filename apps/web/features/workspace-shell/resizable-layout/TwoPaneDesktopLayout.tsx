"use client";

import React from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

import { Card, CardContent } from "@hexagen/ui";
import type { UsePanelCollapseReturn } from "../hooks/usePanelCollapse";

import { PanelHeader } from "./PanelHeader";
import { CollapsedStrip } from "./CollapsedStrip";
import { VerticalResizeHandle } from "./VerticalResizeHandle";
import {
  TWO_PANE_LEFT_SIZES,
  TWO_PANE_RIGHT_SIZES,
  TWO_PANE_AUTO_SAVE_ID,
} from "./constants";

export interface TwoPaneDesktopLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftTitle: string;
  /** Pinned to the bottom of the left column (e.g. "Add planning session"). */
  leftFooter?: React.ReactNode;
  leftCollapse: UsePanelCollapseReturn;
}

/**
 * Two-panel horizontal layout for large viewports. The left column is
 * collapsible and owns an optional pinned footer; the right column holds the
 * primary content and is always visible. Widths persist via
 * TWO_PANE_AUTO_SAVE_ID. The right column intentionally has no header — its
 * content owns its own chrome (the interacted resource's title changes).
 */
export const TwoPaneDesktopLayout = React.memo(function TwoPaneDesktopLayout({
  left,
  right,
  leftTitle,
  leftFooter,
  leftCollapse,
}: TwoPaneDesktopLayoutProps) {
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
        autoSaveId={TWO_PANE_AUTO_SAVE_ID}
        className="flex-1 h-full"
      >
        <Panel
          ref={leftCollapse.ref}
          id="plan-left"
          order={1}
          defaultSize={TWO_PANE_LEFT_SIZES.defaultSize}
          minSize={TWO_PANE_LEFT_SIZES.minSize}
          maxSize={TWO_PANE_LEFT_SIZES.maxSize}
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
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-auto">
              {left}
            </CardContent>
            {leftFooter && (
              <div className="border-t border-border p-3 shrink-0">
                {leftFooter}
              </div>
            )}
          </Card>
        </Panel>

        <VerticalResizeHandle />

        <Panel
          id="plan-right"
          order={2}
          defaultSize={TWO_PANE_RIGHT_SIZES.defaultSize}
          minSize={TWO_PANE_RIGHT_SIZES.minSize}
        >
          <Card className="h-full overflow-hidden border border-border rounded-md flex flex-col">
            {right}
          </Card>
        </Panel>
      </PanelGroup>
    </div>
  );
});
