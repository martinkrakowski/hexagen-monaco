"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";

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

interface MonacoEditorWrapperProps {
  initialBuffer: string;
  sessionId: string;
  language?: string;
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
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialBuffer);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";

  const persistence = getMonacoPersistence();

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

  const saveSession = (newValue: string) => {
    const save = async () => {
      try {
        const session = new MonacoSession(sessionId, newValue, language);
        const result = await persistence.saveSession(session);
        if (!result.success) {
          setError(result.error?.message || "Save failed");
        }
      } catch (err) {
        const msg = (err as Error).message || "Save error";
        setError(msg);
      }
    };

    const timeout = setTimeout(save, 800);
    return () => clearTimeout(timeout);
  };

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    bufferStatePortRef.current.setEditorRef(editor);
  };

  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) {
      setContent(value);
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
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-muted-foreground">Loading session...</span>
        </div>
      ) : (
        <Editor
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
