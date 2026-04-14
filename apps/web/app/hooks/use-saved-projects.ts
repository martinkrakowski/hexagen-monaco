"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";

const STORAGE_KEY = "hexagen-saved-projects";
const CURRENT_SCHEMA_VERSION = 1;

export interface SavedProject {
  id: string;
  name: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  formState: ProjectConfig;
  manifestYaml: string;
}

function readFromStorage(): SavedProject[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        p.schemaVersion === CURRENT_SCHEMA_VERSION &&
        typeof p.formState === "object",
    );
  } catch {
    return [];
  }
}

function writeToStorage(projects: SavedProject[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useSavedProjects() {
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<SavedProject[]>([]);

  useEffect(() => {
    setMounted(true);
    setProjects(readFromStorage());
  }, []);

  const saveProject = useCallback(
    (name: string, formState: ProjectConfig, manifestYaml: string): string => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const newProject: SavedProject = {
        id,
        name,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        formState,
        manifestYaml,
      };
      const updated = [newProject, ...projects];
      setProjects(updated);
      writeToStorage(updated);
      return id;
    },
    [projects],
  );

  const loadProject = useCallback(
    (id: string): SavedProject | undefined => {
      return projects.find((p) => p.id === id);
    },
    [projects],
  );

  const deleteProject = useCallback(
    (id: string): void => {
      const updated = projects.filter((p) => p.id !== id);
      setProjects(updated);
      writeToStorage(updated);
    },
    [projects],
  );

  const renameProject = useCallback(
    (id: string, newName: string): void => {
      const updated = projects.map((p) =>
        p.id === id ? { ...p, name: newName, updatedAt: Date.now() } : p,
      );
      setProjects(updated);
      writeToStorage(updated);
    },
    [projects],
  );

  const updateProject = useCallback(
    (id: string, formState: ProjectConfig, manifestYaml: string): void => {
      const updated = projects.map((p) =>
        p.id === id
          ? { ...p, formState, manifestYaml, updatedAt: Date.now() }
          : p,
      );
      setProjects(updated);
      writeToStorage(updated);
    },
    [projects],
  );

  if (!mounted) {
    return {
      projects: [] as SavedProject[],
      saveProject: () => "",
      loadProject: () => undefined,
      deleteProject: () => {},
      renameProject: () => {},
      updateProject: () => {},
    };
  }

  return {
    projects,
    saveProject,
    loadProject,
    deleteProject,
    renameProject,
    updateProject,
  };
}
