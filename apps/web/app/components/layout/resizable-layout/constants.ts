/**
 * Size and persistence constants for the resizable three-panel layout.
 * Sizes are percentages of the horizontal PanelGroup width.
 */

export const LEFT_PANEL_SIZES = {
  defaultSize: 25,
  minSize: 15,
  maxSize: 35,
} as const;

export const MIDDLE_PANEL_SIZES = {
  defaultSize: 50,
  minSize: 30,
} as const;

export const RIGHT_PANEL_SIZES = {
  defaultSize: 25,
  minSize: 15,
  maxSize: 40,
} as const;

/**
 * react-resizable-panels persists the user's drag-adjusted sizes under
 * this key in localStorage. Bump the version suffix if we add/remove
 * panels or rearrange ids, so old cached layouts don't break new code.
 */
export const LAYOUT_AUTO_SAVE_ID = "hexagen-workspace-layout-v1";
