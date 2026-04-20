"use client";

import { useCallback, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

interface UsePanelCollapseOptions {
  /** Size (%) to restore to when the user clicks "expand". */
  defaultExpandedSize: number;
}

export interface UsePanelCollapseReturn {
  /** Attach to the <Panel ref={...}> */
  ref: React.RefObject<ImperativePanelHandle | null>;
  isCollapsed: boolean;
  /** Programmatically collapse the panel. */
  collapse: () => void;
  /** Programmatically expand back to the default size. */
  expand: () => void;
  /** Wire to <Panel onCollapse={...}>. */
  onPanelCollapse: () => void;
  /** Wire to <Panel onExpand={...}>. */
  onPanelExpand: () => void;
}

/**
 * Encapsulates the imperative-panel ref + collapse state + handlers
 * pattern for a single collapsible panel. Eliminates the left/right
 * mirror-image duplication in ResizableLayout.
 *
 * The two callbacks prefixed `onPanel*` are meant to be wired to the
 * <Panel> component's own `onCollapse`/`onExpand` events; they keep
 * our local state in sync when the user drags the panel closed past
 * the minSize threshold. The `collapse`/`expand` functions are for
 * programmatic (button-click) invocation.
 */
export function usePanelCollapse(
  options: UsePanelCollapseOptions,
): UsePanelCollapseReturn {
  const { defaultExpandedSize } = options;
  const ref = useRef<ImperativePanelHandle | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const collapse = useCallback(() => {
    ref.current?.collapse();
  }, []);

  const expand = useCallback(() => {
    ref.current?.resize(defaultExpandedSize);
  }, [defaultExpandedSize]);

  const onPanelCollapse = useCallback(() => {
    setIsCollapsed(true);
  }, []);

  const onPanelExpand = useCallback(() => {
    setIsCollapsed(false);
  }, []);

  return {
    ref,
    isCollapsed,
    collapse,
    expand,
    onPanelCollapse,
    onPanelExpand,
  };
}
