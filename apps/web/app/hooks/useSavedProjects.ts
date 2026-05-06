"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type {
  SavedProject as BaseSavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import { getSavedProjectsPersistence } from "../lib/wire.client";

const CURRENT_SCHEMA_VERSION = 2;

export interface SavedProject extends BaseSavedProject {
  readonly formState: ProjectConfig;
}

function toBase(project: SavedProject): BaseSavedProject {
  return project;
}

function fromBase(base: BaseSavedProject): SavedProject {
  return base as SavedProject;
}

export function useSavedProjects() {
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<SavedProject[]>([]);

  const port: SavedProjectsPersistencePort = getSavedProjectsPersistence();

  useEffect(() => {
    setMounted(true);
    port.loadProjects().then((result) => {
      if (result.success) {
        setProjects(result.value.map(fromBase));
      }
    });
  }, [port]);

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
      port.saveProjects(updated.map(toBase));
      return id;
    },
    [projects, port],
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
      port.saveProjects(updated.map(toBase));
    },
    [projects, port],
  );

  const renameProject = useCallback(
    (id: string, newName: string): void => {
      const updated = projects.map((p) =>
        p.id === id ? { ...p, name: newName, updatedAt: Date.now() } : p,
      );
      setProjects(updated);
      port.saveProjects(updated.map(toBase));
    },
    [projects, port],
  );

  const updateProject = useCallback(
    (id: string, formState: ProjectConfig, manifestYaml: string): void => {
      const updated = projects.map((p) =>
        p.id === id
          ? { ...p, formState, manifestYaml, updatedAt: Date.now() }
          : p,
      );
      setProjects(updated);
      port.saveProjects(updated.map(toBase));
    },
    [projects, port],
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
