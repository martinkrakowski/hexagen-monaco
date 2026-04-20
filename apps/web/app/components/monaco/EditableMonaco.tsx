"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Editor, { DiffEditor, OnMount, OnChange } from "@monaco-editor/react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { Save, X, Edit3, Loader2, AlertTriangle } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useSharedState } from "@/hooks/useSharedState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";

interface EditableMonacoProps {
  /** The file content to display. Treated as the baseline for diff tracking. */
  initialContent: string;
  language?: string;
  sessionId: string;
  onSave?: (content: string) => void;
}

export function EditableMonaco({
  initialContent,
  language = "yaml",
  sessionId,
  onSave,
}: EditableMonacoProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [baselineContent, setBaselineContent] = useState(initialContent);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const { emitCodeChange } = useSharedState();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // When the parent changes initialContent (e.g. user selects a different file),
  // reset everything back to read-only with the new content.
  useEffect(() => {
    setContent(initialContent);
    setBaselineContent(initialContent);
    setIsEditing(false);
    setHasChanges(false);
  }, [initialContent]);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) {
      setContent(value);
      setHasChanges(value !== baselineContent);
    }
  };

  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setHasChanges(false);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      emitCodeChange({
        type: "code-change",
        content,
        source: "monaco",
        sessionId,
      });
      if (onSave) {
        onSave(content);
      }
      setBaselineContent(content);
      setIsEditing(false);
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  }, [content, sessionId, onSave, emitCodeChange]);

  const handleDiscardClick = useCallback(() => {
    if (hasChanges) {
      setShowDiscardDialog(true);
    } else {
      setIsEditing(false);
      setContent(baselineContent);
    }
  }, [hasChanges, baselineContent]);

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    setIsEditing(false);
    setContent(baselineContent);
    setHasChanges(false);
  }, [baselineContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono uppercase">
            {language}
          </span>
          {isEditing && (
            <span
              className={`text-xs ${hasChanges ? "text-amber-500" : "text-emerald-500"}`}
            >
              {hasChanges ? "Unsaved changes" : "Editing"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button
              type="button"
              onClick={handleEdit}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-8 px-3 border border-input hover:bg-accent hover:text-accent-foreground"
            >
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDiscardClick}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-8 px-3 hover:bg-destructive/10 text-destructive"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-8 px-3 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          key={`editor-${monacoTheme}-${isEditing}`}
          height="100%"
          language={language}
          value={content}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          theme={monacoTheme}
          options={{
            readOnly: !isEditing,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            padding: { top: 16, bottom: 16 },
            renderLineHighlight: isEditing ? "line" : "none",
          }}
        />
      </div>

      {/* Discard confirmation dialog with inline diff */}
      <Dialog
        open={showDiscardDialog}
        onClose={() => setShowDiscardDialog(false)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Discard Changes?
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes. The diff below shows what will be lost.
            </DialogDescription>
          </DialogHeader>

          {showDiscardDialog && (
            <div className="mt-4 rounded-lg overflow-hidden border border-border h-[40vh]">
              <DiffEditor
                original={baselineContent}
                modified={content}
                language={language}
                theme={monacoTheme}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  renderSideBySide: true,
                  automaticLayout: true,
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                }}
              />
            </div>
          )}

          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setShowDiscardDialog(false)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-10 py-2 px-4 border border-input hover:bg-accent hover:text-accent-foreground"
            >
              Keep Editing
            </button>
            <button
              type="button"
              onClick={handleConfirmDiscard}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-10 py-2 px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
