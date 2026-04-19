"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export interface ActiveWorkspace {
  projectId: string;
  name: string;
  isDirty: boolean;
  lastModifiedAt: number;
  // Wizard-form snapshot used to reconstruct a Manifest on-demand for export.
  wizardData?: Record<string, unknown>;
  // Manifest YAML snapshot (optional — useful for display/preview).
  manifestYaml?: string;
}

interface ActiveWorkspaceContextValue {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace) => void;
  clearActiveWorkspace: () => void;
  markDirty: () => void;
  markClean: () => void;
}

const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(
  null,
);

const STORAGE_KEY = "hexagen-active-workspace";

function getStoredWorkspace(): ActiveWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.projectId === "string") {
      return parsed as ActiveWorkspace;
    }
    return null;
  } catch {
    return null;
  }
}

function storeWorkspace(workspace: ActiveWorkspace | null): void {
  if (typeof window === "undefined") return;
  if (workspace) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspace, setActiveWorkspaceState] =
    useState<ActiveWorkspace | null>(null);

  useEffect(() => {
    const stored = getStoredWorkspace();
    if (stored) {
      setActiveWorkspaceState(stored);
    }
  }, []);

  const setActiveWorkspace = useCallback((workspace: ActiveWorkspace) => {
    setActiveWorkspaceState(workspace);
    storeWorkspace(workspace);
  }, []);

  const clearActiveWorkspace = useCallback(() => {
    setActiveWorkspaceState(null);
    storeWorkspace(null);
  }, []);

  const markDirty = useCallback(() => {
    setActiveWorkspaceState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, isDirty: true, lastModifiedAt: Date.now() };
      storeWorkspace(updated);
      return updated;
    });
  }, []);

  const markClean = useCallback(() => {
    setActiveWorkspaceState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, isDirty: false, lastModifiedAt: Date.now() };
      storeWorkspace(updated);
      return updated;
    });
  }, []);

  const value: ActiveWorkspaceContextValue = {
    activeWorkspace,
    setActiveWorkspace,
    clearActiveWorkspace,
    markDirty,
    markClean,
  };

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
