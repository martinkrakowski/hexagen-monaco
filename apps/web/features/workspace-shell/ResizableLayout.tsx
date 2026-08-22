"use client";

import React from "react";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { usePanelCollapse } from "./hooks/usePanelCollapse";

import {
  DesktopLayout,
  MobileLayout,
  LEFT_PANEL_SIZES,
  RIGHT_PANEL_SIZES,
} from "./resizable-layout";

interface ResizableLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** Title rendered above the left panel. Content owns the vocabulary. */
  leftTitle: string;
  /** Title rendered above the right panel. */
  rightTitle: string;
  /** Called when the right panel is collapsed — clears ?right= from URL. */
  onRightPanelClose?: () => void;
  /** Called when the left panel is collapsed — clears ?middle= from URL. */
  onLeftPanelClose?: () => void;
}

/**
 * Public entry for the workspace layout. Chooses between the 3-panel
 * DesktopLayout and the tab-based MobileLayout based on viewport.
 * All panel-specific rendering lives in `./resizable-layout/`.
 */
export const ResizableLayout = React.memo(function ResizableLayout(
  props: ResizableLayoutProps,
) {
  const { onRightPanelClose, onLeftPanelClose, ...rest } = props;
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === "lg";

  const leftCollapse = usePanelCollapse({
    defaultExpandedSize: LEFT_PANEL_SIZES.defaultSize,
    onClose: onLeftPanelClose,
  });
  const rightCollapse = usePanelCollapse({
    defaultExpandedSize: RIGHT_PANEL_SIZES.defaultSize,
    onClose: onRightPanelClose,
  });

  return (
    <div className="h-screen w-full overflow-hidden p-4 bg-background">
      {isDesktop ? (
        <DesktopLayout
          {...rest}
          leftCollapse={leftCollapse}
          rightCollapse={rightCollapse}
        />
      ) : (
        <MobileLayout {...rest} />
      )}
    </div>
  );
});
