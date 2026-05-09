"use client";

import { useMemo } from "react";

import { useEditorWorkspace } from "./useEditorWorkspace";
import {
  useActiveWorkspace,
  type ActiveWorkspace,
} from "@/contexts/ActiveWorkspaceContext";

export interface UseEditorSessionReturn {
  // Editor workspace state
  selectedFileId: string | null;
  editedFiles: Record<string, string>;

  // Editor actions
  setSessionId: (id: string) => void;
  clearSession: () => void;
  selectFile: (id: string | null) => void;
  updateFile: (id: string, content: string, isNew?: boolean) => void;
  markFileSaved: (id: string) => void;

  // Active workspace
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace) => void;
  clearActiveWorkspace: () => void;
}

/**
 * Unifies the editor workspace (per-session file state) and active
 * workspace (current project metadata + manifest). The two hooks are
 * composed here because every project-lifecycle operation needs both:
 * loading a project sets a new session id AND writes active workspace,
 * clearing a project drops the session AND clears active workspace.
 */
export function useEditorSession(): UseEditorSessionReturn {
  const {
    state,
    setSessionId,
    clearSession,
    selectFile,
    updateFile,
    markFileSaved,
  } = useEditorWorkspace();

  const { activeWorkspace, setActiveWorkspace, clearActiveWorkspace } =
    useActiveWorkspace();

  // Memo: flattens the Map<fileId, FileEntry> into Record<fileId, content>
  // for consumers that only need file text (Monaco viewer, diff panels).
  const editedFiles = useMemo(() => {
    const record: Record<string, string> = {};
    for (const [fileId, entry] of state.files) {
      record[fileId] = entry.content;
    }
    return record;
  }, [state.files]);

  return useMemo(
    () => ({
      selectedFileId: state.selectedFileId,
      editedFiles,
      setSessionId,
      clearSession,
      selectFile,
      updateFile,
      markFileSaved,
      activeWorkspace,
      setActiveWorkspace,
      clearActiveWorkspace,
    }),
    [
      state.selectedFileId,
      editedFiles,
      setSessionId,
      clearSession,
      selectFile,
      updateFile,
      markFileSaved,
      activeWorkspace,
      setActiveWorkspace,
      clearActiveWorkspace,
    ],
  );
}
