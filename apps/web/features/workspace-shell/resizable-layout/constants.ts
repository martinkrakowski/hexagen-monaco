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

/**
 * Sizes and persistence key for the two-pane plan workbench (left form column +
 * right main/chat column). Separate from the three-panel workspace so the two
 * layouts persist independently and can't corrupt each other's cached widths.
 */
export const TWO_PANE_LEFT_SIZES = {
  defaultSize: 34,
  minSize: 22,
  maxSize: 45,
} as const;

export const TWO_PANE_RIGHT_SIZES = {
  defaultSize: 66,
  minSize: 45,
} as const;

export const TWO_PANE_AUTO_SAVE_ID = "hexagen-plan-workbench-v1";
