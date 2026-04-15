"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { Save, Loader2 } from "lucide-react";

import {
  UndoLastPatchUseCase,
  ProjectCurrentBufferStateUseCase,
  MonacoSession,
} from "@hexagen/monaco-orchestration";

import type {
  UndoLastPatchPort,
  ProjectCurrentBufferStatePort,
} from "@hexagen/monaco-orchestration";

import { getMonacoPersistence } from "@/lib/wire";
import { useTheme } from "@/hooks/use-theme";
import { useSharedState } from "@/hooks/use-shared-state";

interface MonacoEditorWrapperProps {
  initialBuffer: string;
  sessionId: string;
  language?: string;
  onSave?: (content: string) => void;
}

class StubUndoPort implements UndoLastPatchPort {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async undo(_: unknown): Promise<unknown> {
    return { success: true, message: "Undo stub executed" };
  }
}

class StubBufferStatePort implements ProjectCurrentBufferStatePort {
  private editorRef: monaco.editor.IStandaloneCodeEditor | null = null;

  setEditorRef(editor: monaco.editor.IStandaloneCodeEditor | null) {
    this.editorRef = editor;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getCurrentState(_: unknown): Promise<unknown> {
    return { content: this.editorRef?.getValue() || "" };
  }
}

export function MonacoEditorWrapper({
  initialBuffer,
  sessionId,
  language = "yaml",
  onSave,
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialBuffer);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";

  const persistence = getMonacoPersistence();
  const { emitCodeChange } = useSharedState();

  const undoPortRef = useRef<StubUndoPort>(new StubUndoPort());
  const bufferStatePortRef = useRef<StubBufferStatePort>(
    new StubBufferStatePort(),
  );

  const undoPort = undoPortRef.current;
  const bufferStatePort = bufferStatePortRef.current;

  const undoLastPatchUseCase = new UndoLastPatchUseCase(undoPort);
  const projectCurrentBufferStateUseCase = new ProjectCurrentBufferStateUseCase(
    bufferStatePort,
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const loadResult = await persistence.loadLatestSession(sessionId);
        if (loadResult.success && loadResult.value) {
          setContent(loadResult.value.content || initialBuffer);
        } else if (!loadResult.success) {
          setError(loadResult.error.message);
        }
      } catch (err) {
        const msg = (err as Error).message || "Failed to load session";
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [sessionId, initialBuffer, persistence]);

  const saveSession = (newValue: string, isManualSave = false) => {
    const save = async () => {
      setIsSaving(true);
      try {
        const session = new MonacoSession(sessionId, newValue, language);
        const result = await persistence.saveSession(session);
        if (!result.success) {
          setError(result.error?.message || "Save failed");
        } else {
          setHasUnsavedChanges(false);
          emitCodeChange({
            type: "code-change",
            content: newValue,
            source: isManualSave ? "monaco" : "monaco",
            sessionId,
          });
          if (onSave) {
            onSave(newValue);
          }
        }
      } catch (err) {
        const msg = (err as Error).message || "Save error";
        setError(msg);
      } finally {
        setIsSaving(false);
      }
    };

    if (isManualSave) {
      save();
    } else {
      const timeout = setTimeout(save, 800);
      return () => clearTimeout(timeout);
    }
  };

  const handleManualSave = useCallback(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      saveSession(currentValue, true);
    }
  }, [sessionId, language, persistence, emitCodeChange, onSave]);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    bufferStatePortRef.current.setEditorRef(editor);
  };

  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) {
      setContent(value);
      setHasUnsavedChanges(true);
      saveSession(value);
    }
  };

  // handleUndo will be used by parent component/toolbar
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleUndo = useCallback(async () => {
    try {
      await undoLastPatchUseCase.execute({ sessionId });

      const currentState = (await projectCurrentBufferStateUseCase.execute({
        sessionId,
      })) as MonacoSession | null;
      const bufferContent = currentState?.content || "";
      setContent(bufferContent);
      if (editorRef.current) {
        editorRef.current.setValue(bufferContent);
      }
    } catch (err) {
      const msg = (err as Error).message || "Undo failed";
      setError(msg);
    }
  }, [sessionId, undoLastPatchUseCase, projectCurrentBufferStateUseCase]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive">
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {language.toUpperCase()}
          </span>
          {hasUnsavedChanges && (
            <span className="text-xs text-amber-500">Unsaved changes</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleManualSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-muted-foreground">Loading session...</span>
        </div>
      ) : (
        <Editor
          key={`editor-${monacoTheme}`}
          height="100%"
          language={language}
          value={content}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          theme={monacoTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      )}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? "Loading session..."
          : error
            ? `Error: ${error}`
            : "Session ready"}
      </div>
    </div>
  );
}
