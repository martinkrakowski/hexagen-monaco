'use client';

import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import {
  UndoLastPatchUseCase,
  ProjectCurrentBufferStateUseCase,
} from '@hexagen/monaco-orchestration';

import type {
  MonacoPersistencePort,
  MonacoSessionState,
  IUndoLastPatchPort,
  IProjectCurrentBufferStatePort,
} from '@hexagen/monaco-orchestration';

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

  // Temporary stub ports (inside component so editorRef is accessible via closure)
  class StubPersistencePort implements MonacoPersistencePort {
    async saveState(data: unknown): Promise<unknown> {
      if (typeof data !== 'object' || data === null || !('sessionId' in data)) {
        throw new Error('Invalid saveState data format');
      }

      const { sessionId, state } = data as {
        sessionId: string;
        state: MonacoSessionState;
      };
      const key = `monaco-session-${sessionId}`;
      localStorage.setItem(key, JSON.stringify(state));
      return { success: true };
    }

    async loadState(data: unknown): Promise<unknown> {
      if (typeof data !== 'object' || data === null || !('sessionId' in data)) {
        throw new Error('Invalid loadState data format');
      }

      const { sessionId } = data as { sessionId: string };
      const key = `monaco-session-${sessionId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as MonacoSessionState;
    }
  }

  class StubUndoPort implements IUndoLastPatchPort {
    async undo(data: unknown): Promise<unknown> {
      console.log('[STUB] undo called with:', data);
      return { success: true, message: 'Undo stub executed' };
    }
  }

  class StubBufferStatePort implements IProjectCurrentBufferStatePort {
    async getCurrentState(data: unknown): Promise<unknown> {
      console.log('[STUB] getCurrentState called with:', data);
      return { content: editorRef.current?.getValue() || '' };
    }
  }

  // Wire use cases with stubs
  const undoPort = new StubUndoPort();
  const bufferStatePort = new StubBufferStatePort();

  const undoLastPatchUseCase = new UndoLastPatchUseCase(undoPort);
  const projectCurrentBufferStateUseCase = new ProjectCurrentBufferStateUseCase(
    bufferStatePort
  );

  const persistencePort = new StubPersistencePort();

  useEffect(() => {
    const load = async () => {
      const loadedState = await persistencePort.loadState({ sessionId });
      const session = loadedState as MonacoSessionState | null;
      const bufferContent = session?.content || initialBuffer;
      setContent(bufferContent);
      editorRef.current?.setValue(bufferContent);
    };
    load();
  }, [sessionId, initialBuffer]);

  const handleEditorDidMount = (
    editorInstance: monaco.editor.IStandaloneCodeEditor
  ) => {
    editorRef.current = editorInstance;
  };

  const handleUndo = async () => {
    try {
      await undoLastPatchUseCase.execute({ sessionId });

      const currentState = (await projectCurrentBufferStateUseCase.execute({
        sessionId,
      })) as MonacoSessionState | null;
      const bufferContent = currentState?.content || '';
      setContent(bufferContent);
      editorRef.current?.setValue(bufferContent);
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
