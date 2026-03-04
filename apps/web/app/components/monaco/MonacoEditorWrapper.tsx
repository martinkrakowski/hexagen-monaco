'use client';

import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'; // Stable ESM entry point for Monaco types

import {
  UndoLastPatchUseCase,
  ProjectCurrentBufferStateUseCase,
} from '@hexagen/monaco-orchestration';

import type {
  MonacoPersistencePort,
  MonacoSessionState,
} from '@hexagen/monaco-orchestration';

// Temporary stub adapter (we replace with real LocalStorage adapter next)
class StubMonacoPersistenceAdapter implements MonacoPersistencePort {
  async loadSession(sessionId: string): Promise<MonacoSessionState | null> {
    const key = `monaco-session-${sessionId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MonacoSessionState;
    } catch {
      return null;
    }
  }

  async saveSession(
    sessionId: string,
    state: MonacoSessionState
  ): Promise<void> {
    const key = `monaco-session-${sessionId}`;
    localStorage.setItem(key, JSON.stringify(state));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `monaco-session-${sessionId}`;
    localStorage.removeItem(key);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const key = `monaco-session-${sessionId}`;
    return localStorage.getItem(key) !== null;
  }
}

interface MonacoEditorWrapperProps {
  initialBuffer: string;
  sessionId: string;
  language?: string;
}

export function MonacoEditorWrapper({
  initialBuffer,
  sessionId,
  language = 'yaml',
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialBuffer);

  const undoLastPatchUseCase = new UndoLastPatchUseCase();
  const projectCurrentBufferStateUseCase =
    new ProjectCurrentBufferStateUseCase();

  const persistencePort = new StubMonacoPersistenceAdapter();

  useEffect(() => {
    const load = async () => {
      const session = await persistencePort.loadSession(sessionId);
      if (session?.content) {
        setContent(session.content);
      }
    };
    load();
  }, [sessionId]);

  const handleEditorDidMount = (
    editorInstance: monaco.editor.IStandaloneCodeEditor
  ) => {
    editorRef.current = editorInstance;
  };

  const handleUndo = async () => {
    try {
      await undoLastPatchUseCase.execute(sessionId);

      const currentState = (await projectCurrentBufferStateUseCase.execute(
        sessionId
      )) as MonacoSessionState | null;

      if (currentState?.content) {
        setContent(currentState.content);
        editorRef.current?.setValue(currentState.content);
      }
    } catch (err) {
      console.error('Undo failed:', err);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
    }
  };

  return (
    <div className="flex flex-col h-full">
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
            wordWrap: 'on',
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
