"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createPersistedStorage } from "@/lib/persisted-state";

export interface ActiveWorkspace {
  projectId: string;
  name: string;
  isDirty: boolean;
  lastModifiedAt: number;
  wizardData?: Record<string, unknown>;
  manifestYaml?: string;
}

export interface ActiveWorkspaceContextValue {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace) => void;
  clearActiveWorkspace: () => void;
}

const ActiveWorkspaceContext =
  createContext<ActiveWorkspaceContextValue | null>(null);

const STORAGE_KEY = "hexagen-active-workspace";

const workspaceStorage = createPersistedStorage<ActiveWorkspace>(
  STORAGE_KEY,
  (candidate): candidate is ActiveWorkspace =>
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as ActiveWorkspace).projectId === "string",
);

let cachedSnapshot: ActiveWorkspace | null = null;

function subscribeWorkspace(callback: () => void) {
  return workspaceStorage.subscribe(() => {
    cachedSnapshot = workspaceStorage.read();
    callback();
  });
}

function getWorkspaceSnapshot(): ActiveWorkspace | null {
  return cachedSnapshot;
}

function getWorkspaceServerSnapshot(): ActiveWorkspace | null {
  return null;
}

function updateCachedSnapshot() {
  cachedSnapshot = workspaceStorage.read();
}

export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  cachedSnapshot = workspaceStorage.read();
  const activeWorkspace = useSyncExternalStore(
    subscribeWorkspace,
    getWorkspaceSnapshot,
    getWorkspaceServerSnapshot,
  );

  const setActiveWorkspace = useCallback((workspace: ActiveWorkspace) => {
    workspaceStorage.write(workspace);
    updateCachedSnapshot();
  }, []);

  const clearActiveWorkspace = useCallback(() => {
    workspaceStorage.write(null);
    cachedSnapshot = null;
  }, []);

  const value = useMemo<ActiveWorkspaceContextValue>(
    () => ({ activeWorkspace, setActiveWorkspace, clearActiveWorkspace }),
    [activeWorkspace, setActiveWorkspace, clearActiveWorkspace],
  );

  return (
    <ActiveWorkspaceContext.Provider value={value}>
      {children}
    </ActiveWorkspaceContext.Provider>
  );
}

export function useActiveWorkspace(): ActiveWorkspaceContextValue {
  const context = useContext(ActiveWorkspaceContext);
  if (!context) {
    throw new Error(
      "useActiveWorkspace must be used within ActiveWorkspaceProvider",
    );
  }
  return context;
}
