"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";

import { createPersistedStorage } from "@/lib/persisted-state";

export interface ActiveWorkspace {
  projectId: string;
  name: string;
  isDirty: boolean;
  lastModifiedAt: number;
  /** Wizard-form snapshot used to reconstruct a Manifest for export. */
  wizardData?: Record<string, unknown>;
  /** Manifest YAML snapshot (for display/preview). */
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

export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspace, setActiveWorkspaceState] =
    useState<ActiveWorkspace | null>(null);

  useEffect(() => {
    const stored = workspaceStorage.read();
    if (stored) setActiveWorkspaceState(stored);
  }, []);

  const setActiveWorkspace = useCallback((workspace: ActiveWorkspace) => {
    setActiveWorkspaceState(workspace);
    workspaceStorage.write(workspace);
  }, []);

  const clearActiveWorkspace = useCallback(() => {
    setActiveWorkspaceState(null);
    workspaceStorage.write(null);
  }, []);

  // Memo prevents consumer re-renders when the provider re-renders
  // for reasons unrelated to workspace state (rare, but useMemo makes
  // the contract explicit: consumers only churn on identity change).
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
