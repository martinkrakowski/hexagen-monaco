/**
 * Custom `React.memo` comparator for `ProjectWorkspaceLayout`.
 *
 * Extracted from the component so it can be unit-tested in isolation (the
 * component module pulls in the whole workspace tree / Next.js runtime).
 *
 * The structural prop shape below intentionally lists ONLY the fields the
 * comparator reads; the full `ProjectWorkspaceLayoutProps` is assignable to it.
 *
 * Regression note: this comparator hand-picks which prop changes force a
 * re-render. The middle panel (code view + editor) reflects the editor session
 * (file selection + edits), and `useEditorSession` returns a NEW reference only
 * when that state changes — so `editor` MUST be compared, or selecting a file
 * (and editing) updates the session but never re-renders `CodeView`.
 */
export interface LayoutMemoProps {
  currentStepIndex: unknown;
  viewMode: unknown;
  onViewModeChange: unknown;
  onCloseMiddlePanel: unknown;
  onCloseRightPanel: unknown;
  // Optional to match ProjectWorkspaceLayoutProps (React.memo's comparator is
  // contravariant in its params, so the optionality must line up).
  onNavigateToProjects?: unknown;
  isEditing: unknown;
  ui: { dialog: { kind: unknown } };
  children?: unknown;
  editor: unknown;
}

/** Return `true` when the layout can skip re-rendering (props are equal). */
export function projectWorkspaceLayoutPropsEqual(
  prev: LayoutMemoProps,
  next: LayoutMemoProps,
): boolean {
  if (prev.currentStepIndex !== next.currentStepIndex) return false;
  if (prev.viewMode !== next.viewMode) return false;
  if (prev.onViewModeChange !== next.onViewModeChange) return false;
  if (prev.onCloseMiddlePanel !== next.onCloseMiddlePanel) return false;
  if (prev.onCloseRightPanel !== next.onCloseRightPanel) return false;
  if (prev.onNavigateToProjects !== next.onNavigateToProjects) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.ui.dialog.kind !== next.ui.dialog.kind) return false;
  if (prev.children !== next.children) return false;
  // The editor session drives the middle panel — re-render whenever it changes.
  if (prev.editor !== next.editor) return false;
  return true;
}
