"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  PersistedEditorWorkspace,
  PersistedEditorWorkspaceFile,
} from "@hexagen/shared";
import {
  getEditorWorkspacePersistence,
  getWizardPersistence,
  getLogger,
  getMigrationReady,
} from "@/lib/wire";

const DEBOUNCE_MS = 500;

function validateFileEntry(
  fileId: string,
  entry: unknown,
): { valid: true; file: PersistedEditorWorkspaceFile } | { valid: false } {
  if (
    entry &&
    typeof entry === "object" &&
    typeof (entry as PersistedEditorWorkspaceFile).content === "string" &&
    typeof (entry as PersistedEditorWorkspaceFile).isNew === "boolean" &&
    typeof (entry as PersistedEditorWorkspaceFile).dirty === "boolean" &&
    typeof (entry as PersistedEditorWorkspaceFile).updatedAt === "number"
  ) {
    return { valid: true, file: entry as PersistedEditorWorkspaceFile };
  }
  return { valid: false };
}

function validateWorkspace(raw: unknown): PersistedEditorWorkspace | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.schemaVersion !== "number") return null;
  if (w.schemaVersion !== 1) return null;
  if (typeof w.sessionId !== "string") return null;
  if (typeof w.updatedAt !== "number") return null;
  if (typeof w.selectedFileId !== "string" && w.selectedFileId !== null)
    return null;
  if (!w.files || typeof w.files !== "object") return null;

  const files: Record<string, PersistedEditorWorkspaceFile> = {};
  const filesObj = w.files as Record<string, unknown>;
  for (const [fileId, entry] of Object.entries(filesObj)) {
    const validated = validateFileEntry(fileId, entry);
    if (validated.valid) {
      files[fileId] = validated.file;
    }
  }

  return {
    schemaVersion: w.schemaVersion as 1,
    sessionId: w.sessionId as string,
    updatedAt: w.updatedAt as number,
    selectedFileId: w.selectedFileId as string | null,
    files,
    unpushed: typeof w.unpushed === "boolean" ? w.unpushed : false,
  };
}

export interface EditorWorkspaceState {
  selectedFileId: string | null;
  files: Map<string, PersistedEditorWorkspaceFile>;
  unpushed: boolean;
}

export function useEditorWorkspace() {
  const [state, setState] = useState<EditorWorkspaceState>({
    selectedFileId: null,
    files: new Map(),
    unpushed: false,
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const pendingWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const loadWorkspace = useCallback(async (sessionId: string) => {
    const persistence = getEditorWorkspacePersistence();
    const result = await persistence.loadWorkspace(sessionId);
    if (!result.success || result.value === null) {
      setState({ selectedFileId: null, files: new Map(), unpushed: false });
      setIsLoaded(true);
      return;
    }

    const validated = validateWorkspace(result.value);
    if (validated === null) {
      setState({ selectedFileId: null, files: new Map(), unpushed: false });
    } else {
      const files = new Map<string, PersistedEditorWorkspaceFile>();
      for (const [fileId, file] of Object.entries(validated.files)) {
        files.set(fileId, file);
      }
      setState({
        selectedFileId: validated.selectedFileId,
        files,
        unpushed: validated.unpushed ?? false,
      });
    }
    setIsLoaded(true);
  }, []);

  const flushToStorage = useCallback(
    async (sessionId: string, nextState: EditorWorkspaceState) => {
      const files: Record<string, PersistedEditorWorkspaceFile> = {};
      for (const [fileId, file] of nextState.files) {
        files[fileId] = file;
      }
      const workspace: PersistedEditorWorkspace = {
        schemaVersion: 1,
        sessionId,
        updatedAt: Date.now(),
        selectedFileId: nextState.selectedFileId,
        files,
        unpushed: nextState.unpushed,
      };
      const persistence = getEditorWorkspacePersistence();
      const result = await persistence.saveWorkspace(sessionId, workspace);
      if (!result.success) {
        getLogger().warn(
          `Failed to persist workspace: ${result.error.message}`,
        );
      }
    },
    [],
  );

  const scheduleWrite = useCallback(
    (sessionId: string, nextState: EditorWorkspaceState) => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
      }
      pendingWriteRef.current = setTimeout(() => {
        flushToStorage(sessionId, nextState);
        pendingWriteRef.current = null;
      }, DEBOUNCE_MS);
    },
    [flushToStorage],
  );

  const initializeFromDraft = useCallback(async () => {
    await getMigrationReady();
    const wizardPersistence = getWizardPersistence();
    const draftResult = await wizardPersistence.loadDraft();
    if (
      draftResult.success &&
      draftResult.value &&
      draftResult.value.sessionId
    ) {
      sessionIdRef.current = draftResult.value.sessionId;
      await loadWorkspace(draftResult.value.sessionId);
    } else {
      setIsLoaded(true);
    }
  }, [loadWorkspace]);

  useEffect(() => {
    initializeFromDraft();
    return () => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
      }
    };
  }, [initializeFromDraft]);

  const setSessionId = useCallback(
    async (sessionId: string) => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
        pendingWriteRef.current = null;
      }
      sessionIdRef.current = sessionId;
      await loadWorkspace(sessionId);
    },
    [loadWorkspace],
  );

  const clearSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current);
      pendingWriteRef.current = null;
    }

    const persistence = getEditorWorkspacePersistence();
    await persistence.clearWorkspace(sessionId);
    sessionIdRef.current = null;
    setState({ selectedFileId: null, files: new Map(), unpushed: false });
    setIsLoaded(true);
  }, []);

  const updateFile = useCallback(
    (fileId: string, content: string, isNew = false) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      setState((prev) => {
        const existing = prev.files.get(fileId);
        const nextFiles = new Map(prev.files);
        nextFiles.set(fileId, {
          content,
          isNew: existing?.isNew ?? isNew,
          dirty: true,
          updatedAt: Date.now(),
        });
        const next = { ...prev, files: nextFiles };
        scheduleWrite(sessionId, next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const selectFile = useCallback(
    (fileId: string | null) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      setState((prev) => {
        const next = { ...prev, selectedFileId: fileId };
        scheduleWrite(sessionId, next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const markFileSaved = useCallback(
    (fileId: string) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      setState((prev) => {
        const existing = prev.files.get(fileId);
        if (!existing) return prev;
        const nextFiles = new Map(prev.files);
        nextFiles.set(fileId, {
          ...existing,
          dirty: false,
          isNew: false,
          updatedAt: Date.now(),
        });
        const next = { ...prev, files: nextFiles, unpushed: true };
        scheduleWrite(sessionId, next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const clearUnpushed = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    setState((prev) => {
      const next = { ...prev, unpushed: false };
      scheduleWrite(sessionId, next);
      return next;
    });
  }, [scheduleWrite]);

  return {
    state,
    isLoaded,
    setSessionId,
    clearSession,
    updateFile,
    selectFile,
    markFileSaved,
    clearUnpushed,
  };
}
