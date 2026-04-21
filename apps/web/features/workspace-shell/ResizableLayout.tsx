"use client";

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
}

/**
 * Public entry for the workspace layout. Chooses between the 3-panel
 * DesktopLayout and the tab-based MobileLayout based on viewport.
 * All panel-specific rendering lives in `./resizable-layout/`.
 */
export function ResizableLayout(props: ResizableLayoutProps) {
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === "lg";

  // Hooks must run unconditionally. Their state only takes effect on
  // desktop, but allocating them here keeps ordering stable across
  // breakpoint transitions.
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
