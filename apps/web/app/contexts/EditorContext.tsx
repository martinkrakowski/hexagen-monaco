"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface EditorState {
  filename: string;
  language: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

interface EditorContextValue {
  editorState: EditorState;
  updateEditorState: (state: Partial<EditorState>) => void;
}

const EditorContext = createContext<EditorContextValue | undefined>(undefined);

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  const [editorState, setEditorState] = useState<EditorState>({
    filename: "manifest.yaml",
    language: "yaml",
    content: "",
    lineStart: 1,
    lineEnd: 1,
  });

  const updateEditorState = useCallback((state: Partial<EditorState>) => {
    setEditorState((prev) => ({ ...prev, ...state }));
  }, []);

  return (
    <EditorContext.Provider value={{ editorState, updateEditorState }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within EditorProvider");
  }
  return context;
}
