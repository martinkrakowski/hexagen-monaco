"use client";

import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
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

interface MonacoEditorWrapperProps {
  initialBuffer: string;
  sessionId: string;
  language?: string;
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

  const persistence = getMonacoPersistence();

  // Stub ports for undo & buffer state (keep until real ports are wired)
  class StubUndoPort implements UndoLastPatchPort {
    async undo(_data: unknown): Promise<unknown> {
      // eslint-disable-next-line no-console
      console.info('[STUB] undo called with:', _data);
      return { success: true, message: "Undo stub executed" };
    }
  }

  class StubBufferStatePort implements ProjectCurrentBufferStatePort {
    async getCurrentState(_data: unknown): Promise<unknown> {
      // eslint-disable-next-line no-console
      console.info('[STUB] getCurrentState called with:', _data);
      return { content: editorRef.current?.getValue() || "" };
    }
  }

  const undoPort = new StubUndoPort();
  const bufferStatePort = new StubBufferStatePort();

  const undoLastPatchUseCase = new UndoLastPatchUseCase(undoPort);
  const projectCurrentBufferStateUseCase = new ProjectCurrentBufferStateUseCase(
    bufferStatePort,
  );

  // Load latest session on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // console.info(`Loading latest session for projectId: ${sessionId}`);
        const loadResult = await persistence.loadLatestSession(sessionId);
        if (loadResult.success && loadResult.value) {
          setContent(loadResult.value.content || initialBuffer);
          if (editorRef.current) {
            editorRef.current.setValue(
              loadResult.value.content || initialBuffer,
            );
          }
          // console.info('Session loaded successfully');
        } else if (!loadResult.success) {
          setError(loadResult.error.message);
          // console.error('Session load failed:', loadResult.error);
        }
      } catch (err) {
        const msg = (err as Error).message || "Failed to load session";
        setError(msg);
        // console.error('Session load exception:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [sessionId, initialBuffer, persistence]);

  // Debounced save on change (simple timeout for MVP)
  const saveSession = (newValue: string) => {
    const save = async () => {
      try {
        // console.debug(`Saving session for projectId: ${sessionId}`);
        const session = new MonacoSession(sessionId, newValue, language);
        const result = await persistence.saveSession(session);
        if (!result.success) {
          setError(result.error?.message || "Save failed");
          // console.error('Session save failed:', result.error);
        } else {
          // console.info('Session saved successfully');
        }
      } catch (err) {
        const msg = (err as Error).message || "Save error";
        setError(msg);
        // console.error('Session save exception:', err);
      }
    };

    const timeout = setTimeout(save, 800);
    return () => clearTimeout(timeout);
  };

  const handleEditorDidMount = (
    editorInstance: monaco.editor.IStandaloneCodeEditor,
  ) => {
    editorRef.current = editorInstance;
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
      saveSession(value);
    }
  };

  const handleUndo = async () => {
    try {
      // console.info(`Undo requested for sessionId: ${sessionId}`);
      await undoLastPatchUseCase.execute({ sessionId });

      const currentState = (await projectCurrentBufferStateUseCase.execute({
        sessionId,
      })) as MonacoSession | null;
      const bufferContent = currentState?.content || "";
      setContent(bufferContent);
      if (editorRef.current) {
        editorRef.current.setValue(bufferContent);
      }
      // console.info('Undo completed');
    } catch (err) {
      const msg = (err as Error).message || "Undo failed";
      // console.error('Undo failed:', err);
      setError(msg);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Accessibility live region */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? "Loading session..."
          : error
            ? `Error: ${error}`
            : "Session ready"}
      </div>

      {/* Header with session info & undo button */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        <div className="text-sm font-medium">
          Monaco Editor — Session: {sessionId}
        </div>
        <button
          onClick={handleUndo}
          className="px-3 py-1 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
          aria-label="Undo last patch"
        >
          Undo Last Patch
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            tabSize: 2,
          }}
          aria-label="Architecture manifest editor"
        />
      </div>
    </div>
  );
}
