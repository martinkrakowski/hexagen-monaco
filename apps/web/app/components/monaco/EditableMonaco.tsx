"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { Save, X, Edit3, Loader2, AlertTriangle } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { useSharedState } from "@/hooks/use-shared-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";

interface EditableMonacoProps {
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
  const [originalContent] = useState(initialContent);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState(false);

  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const { emitCodeChange } = useSharedState();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setContent(initialContent);
      setHasChanges(false);
    }
  }, [initialContent, isEditing]);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) {
      setContent(value);
      setHasChanges(value !== originalContent);
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
      setContent(originalContent);
    }
  }, [hasChanges, originalContent]);

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    setIsEditing(false);
    setContent(originalContent);
    setHasChanges(false);
  }, [originalContent]);

  const getDiffContent = useCallback(() => {
    const original = originalContent.split("\n");
    const current = content.split("\n");

    let diff = "";
    const maxLines = Math.max(original.length, current.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = original[i] ?? "";
      const currLine = current[i] ?? "";

      if (origLine !== currLine) {
        if (origLine && !currLine) {
          diff += `- ${origLine}\n`;
        } else if (!origLine && currLine) {
          diff += `+ ${currLine}\n`;
        } else {
          diff += `- ${origLine}\n+ ${currLine}\n`;
        }
      }
    }

    return diff || "No changes";
  }, [originalContent, content]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono uppercase">
            {language}
          </span>
          {hasChanges && isEditing && (
            <span className="text-xs text-amber-500">Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button
              type="button"
              onClick={handleEdit}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-9 px-3 border border-input hover:bg-accent hover:text-accent-foreground"
            >
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDiscardClick}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-9 px-3 hover:bg-accent hover:text-accent-foreground text-destructive"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-9 px-3 bg-primary text-primary-foreground hover:bg-primary/90"
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
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
          }}
        />
      </div>

      <Dialog
        open={showDiscardDialog}
        onClose={() => setShowDiscardDialog(false)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Discard Changes?
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes that will be lost. Here&apos;s a diff of
              what you&apos;ll lose:
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 p-4 bg-muted rounded-lg overflow-auto max-h-[40vh]">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {getDiffContent()}
            </pre>
          </div>

          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setShowDiscardDialog(false)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-10 py-2 px-4 border border-input hover:bg-accent hover:text-accent-foreground"
            >
              Keep Editing
            </button>
            <button
              type="button"
              onClick={handleConfirmDiscard}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-10 py-2 px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
