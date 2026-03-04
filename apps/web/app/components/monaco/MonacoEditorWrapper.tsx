'use client';

import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  UndoLastPatchUseCase,
  ProjectCurrentBufferStateUseCase,
  MonacoPersistencePort,
} from '@hexagen/monaco-orchestration';
import * as monaco from 'monaco-editor';

interface MonacoEditorWrapperProps {
  initialBuffer: string;
  sessionId: string;
}

export function MonacoEditorWrapper({
  initialBuffer,
  sessionId,
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      const session = await MonacoPersistencePort.loadSession(sessionId);
      if (session?.currentBuffer) {
        editorRef.current?.setValue(session.currentBuffer);
      } else {
        editorRef.current?.setValue(initialBuffer);
      }
    };
    loadSession();
  }, [initialBuffer, sessionId]);

  const handleUndo = () => {
    UndoLastPatchUseCase.execute(sessionId).then((result) => {
      if (result.success) {
        editorRef.current?.setValue(result.revertedBuffer);
      }
    });
  };

  useEffect(() => {
    ProjectCurrentBufferStateUseCase.execute(sessionId);
  }, [sessionId]);

  return (
    <div
      className="h-full flex flex-col"
      role="region"
      aria-label="Agentic Code Editor"
    >
      <Editor
        height="100%"
        defaultLanguage="yaml"
        defaultValue={initialBuffer}
        onMount={(editor) => {
          editorRef.current = editor;
        }}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          readOnly: false,
        }}
      />
      <div className="p-2 border-t flex justify-end">
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded"
          onClick={handleUndo}
          aria-label="Undo last patch"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
