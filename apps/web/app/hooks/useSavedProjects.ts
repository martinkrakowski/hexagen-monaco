"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type {
  SavedProject as BaseSavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
} from "@hexagen/shared";
import {
  getSavedProjectsPersistence,
  getMigrationReady,
} from "../lib/wire.client";

const CURRENT_SCHEMA_VERSION = 3;

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
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [persistError, setPersistError] = useState<PersistenceError | null>(
    null,
  );
  const projectsRef = useRef(projects);
  const mutationSeq = useRef(0);

  const port: SavedProjectsPersistencePort = getSavedProjectsPersistence();

  useEffect(() => {
    setMounted(true);
    const load = async () => {
      await getMigrationReady();
      const result = await port.loadProjects();
      if (result.success) {
        const loaded = result.value.map(fromBase);
        projectsRef.current = loaded;
        setProjects(loaded);
      }
      setIsLoading(false);
    };
    load();
  }, [port]);

  const clearError = useCallback(() => setPersistError(null), []);

  const saveProject = useCallback(
    async (
      name: string,
      formState: ProjectConfig,
      manifestYaml: string,
    ): Promise<string | null> => {
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
      const snapshot = projectsRef.current;
      const updated = [newProject, ...snapshot];
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated); // optimistic; reverted below if the write fails
      // Await the persistence write so callers can navigate only after the
      // project is durably committed (the IndexedDB adapter is async).
      // Returning the id before the write resolved caused approved projects to
      // be "lost" when the next screen read storage before the write landed.
      const result = await port.saveProjects(updated.map(toBase));
      if (!result.success) {
        if (mutationSeq.current === seq) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
        }
        return null;
      }
      return id;
    },
    [port],
  );

  const loadProject = useCallback(
    (id: string): SavedProject | undefined => {
      return projects.find((p) => p.id === id);
    },
    [projects],
  );

  const deleteProject = useCallback(
    (id: string): void => {
      const snapshot = projectsRef.current;
      const updated = snapshot.filter((p) => p.id !== id);
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated);
      port.saveProjects(updated.map(toBase)).then((result) => {
        if (!result.success && mutationSeq.current === seq) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
        }
      });
    },
    [port],
  );

  const renameProject = useCallback(
    (id: string, newName: string): void => {
      const snapshot = projectsRef.current;
      const updated = snapshot.map((p) =>
        p.id === id ? { ...p, name: newName, updatedAt: Date.now() } : p,
      );
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated);
      port.saveProjects(updated.map(toBase)).then((result) => {
        if (!result.success && mutationSeq.current === seq) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
        }
      });
    },
    [port],
  );

  const updateProject = useCallback(
    (id: string, formState: ProjectConfig, manifestYaml: string): void => {
      const snapshot = projectsRef.current;
      const updated = snapshot.map((p) =>
        p.id === id
          ? { ...p, formState, manifestYaml, updatedAt: Date.now() }
          : p,
      );
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated);
      port.saveProjects(updated.map(toBase)).then((result) => {
        if (!result.success && mutationSeq.current === seq) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
        }
      });
    },
    [port],
  );

  if (!mounted) {
    return {
      isLoading: true,
      projects: [] as SavedProject[],
      saveProject: async () => null,
      loadProject: () => undefined,
      deleteProject: () => {},
      renameProject: () => {},
      updateProject: () => {},
      persistError: null as PersistenceError | null,
      clearError: () => {},
    };
  }

  return {
    isLoading,
    projects,
    saveProject,
    loadProject,
    deleteProject,
    renameProject,
    updateProject,
    persistError,
    clearError,
  };
}
