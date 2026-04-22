import type { editor } from "monaco-editor/esm/vs/editor/editor.api";

/**
 * Monaco options shared across the Editor and DiffEditor. Font family,
 * sizes, minimap, etc. are the same in both views — defining them
 * once prevents drift.
 */
const BASE_MONACO_FONT =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

export function createEditorOptions(
  isEditing: boolean,
): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: !isEditing,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "on",
    fontFamily: BASE_MONACO_FONT,
    padding: { top: 16, bottom: 16 },
    renderLineHighlight: isEditing ? "line" : "none",
  };
}

export const DIFF_EDITOR_OPTIONS: editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  scrollBeyondLastLine: false,
  renderSideBySide: true,
  automaticLayout: true,
  fontFamily: BASE_MONACO_FONT,
};
