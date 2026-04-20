"use client";

import { useCallback, useMemo, useRef } from "react";
import Editor, { type OnMount, type OnChange } from "@monaco-editor/react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";

import { useTheme } from "@/hooks/useTheme";
import { useSharedState } from "@/hooks/useSharedState";
import { useEditableMonacoState } from "@/hooks/useEditableMonacoState";

import {
  EditorToolbar,
  DiscardChangesDialog,
  createEditorOptions,
} from "./editable-monaco";

interface EditableMonacoProps {
  /** File content baseline — resets editor state when it changes. */
  initialContent: string;
  language?: string;
  sessionId: string;
  onSave?: (content: string) => void;
}

/**
 * Monaco editor with toolbar, edit/save/discard flow, and a
 * discard-confirmation dialog that shows an inline diff.
 *
 * All state lives in useEditableMonacoState. Sub-UI (toolbar, dialog,
 * options) is extracted to ./editable-monaco/. This component just
 * composes them and wires the Monaco `<Editor>` instance.
 */
export function EditableMonaco({
  initialContent,
  language = "yaml",
  sessionId,
  onSave,
}: EditableMonacoProps) {
  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const { emitCodeChange } = useSharedState();

  const {
    mode,
    dialog,
    content,
    baselineContent,
    beginEdit,
    onContentChange,
    save,
    requestDiscard,
    confirmDiscard,
    cancelDiscard,
  } = useEditableMonacoState(initialContent);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) onContentChange(value);
  };

  const handleSave = useCallback(() => {
    return save(async (saved) => {
      emitCodeChange({
        type: "code-change",
        content: saved,
        source: "monaco",
        sessionId,
      });
      onSave?.(saved);
    });
  }, [save, emitCodeChange, sessionId, onSave]);

  const isEditing = mode.kind === "editing";

  // Memoize options — Monaco calls updateOptions() on reference change,
  // so rebuilding this object every render causes avoidable churn. The
  // only dependency is isEditing (toggles readOnly + line highlight).
  const editorOptions = useMemo(
    () => createEditorOptions(isEditing),
    [isEditing],
  );

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar
        language={language}
        mode={mode}
        onEdit={beginEdit}
        onSave={() => void handleSave()}
        onDiscard={requestDiscard}
      />

      <div className="flex-1 overflow-hidden">
        <Editor
          key={`editor-${monacoTheme}-${isEditing}`}
          height="100%"
          language={language}
          value={content}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          theme={monacoTheme}
          options={editorOptions}
        />
      </div>

      <DiscardChangesDialog
        open={dialog.kind === "discard-confirm"}
        language={language}
        theme={monacoTheme}
        originalContent={baselineContent}
        modifiedContent={content}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
