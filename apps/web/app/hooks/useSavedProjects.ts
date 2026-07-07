"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type {
  SavedProject as BaseSavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  ProjectLayer,
} from "@hexagen/shared";
import { SAVED_PROJECT_SCHEMA_VERSION } from "@hexagen/shared";
import {
  getSavedProjectsPersistence,
  getMigrationReady,
} from "../lib/wire.client";

/**
 * App-level narrowing of the domain `SavedProject`: `formState` is the concrete
 * `ProjectConfig`, and `layers` is a *required* array. The domain type keeps
 * both loose/optional (honest for raw records + the write path); the load
 * perimeter (`normalizeLoadedProjects`) upholds the required-`layers` guarantee
 * by defaulting it to `[]`, so consumers never write `saved.layers ?? []`.
 */
export interface SavedProject extends BaseSavedProject {
  readonly formState: ProjectConfig;
  readonly layers: readonly ProjectLayer[];
}

/** A new layer without the hook-stamped identity/timestamps. */
export type NewProjectLayer = Omit<
  ProjectLayer,
  "id" | "createdAt" | "updatedAt"
>;

/** The mutable fields of an existing layer (`updateLayer` patch). */
export type ProjectLayerPatch = Partial<Pick<ProjectLayer, "title" | "turns">>;

function toBase(project: SavedProject): BaseSavedProject {
  return project;
}

function fromBase(base: BaseSavedProject): SavedProject {
  // The load perimeter (normalizeLoadedProjects) already guarantees `layers`,
  // but default it here too so the app boundary that DECLARES `layers` required
  // is self-consistent: it keeps the layer mutations' `[...p.layers]` safe
  // against any port that doesn't normalize, without spreading `?? []` through
  // consumers (the whole point of narrowing to a required array).
  return { ...base, layers: base.layers ?? [] } as SavedProject;
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
      // Provenance captured at creation time (e.g. the imported spec text from
      // the accept flow) — persisted atomically with the project so a separate
      // follow-up write can't fail and leave the project without its layer.
      initialLayers: NewProjectLayer[] = [],
    ): Promise<string | null> => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const newProject: SavedProject = {
        id,
        name,
        schemaVersion: SAVED_PROJECT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        formState,
        manifestYaml,
        layers: initialLayers.map((layer) => ({
          ...layer,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        })),
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

  // Persist a layer mutation with the AWAITED-write + optimistic-revert contract
  // of saveProject — deliberately NOT the fire-and-forget updateProject path.
  // A layer paste is a large, hard-to-reconstruct transcript: the caller (e.g.
  // the "Add planning session" modal) must know whether the write landed before
  // it closes/navigates, and a failed write (most plausibly StorageQuotaExceeded)
  // must surface persistError rather than optimistically appear then silently
  // revert. Returns whether the write committed.
  const commitLayerMutation = useCallback(
    async (
      snapshot: SavedProject[],
      updated: SavedProject[],
    ): Promise<boolean> => {
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated); // optimistic; reverted below if the write fails
      const result = await port.saveProjects(updated.map(toBase));
      if (!result.success) {
        if (mutationSeq.current === seq) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
        }
        return false;
      }
      return true;
    },
    [port],
  );

  const addLayer = useCallback(
    async (
      projectId: string,
      layer: NewProjectLayer,
    ): Promise<string | null> => {
      const snapshot = projectsRef.current;
      // Unknown/genesis project id → explicit failure, not a silent no-op that
      // rewrites the whole array (and looks like success to the caller).
      if (!snapshot.some((p) => p.id === projectId)) return null;
      const now = Date.now();
      const newLayer: ProjectLayer = {
        ...layer,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const updated = snapshot.map((p) =>
        p.id === projectId
          ? { ...p, layers: [...p.layers, newLayer], updatedAt: now }
          : p,
      );
      const committed = await commitLayerMutation(snapshot, updated);
      return committed ? newLayer.id : null;
    },
    [commitLayerMutation],
  );

  const updateLayer = useCallback(
    async (
      projectId: string,
      layerId: string,
      patch: ProjectLayerPatch,
    ): Promise<boolean> => {
      const snapshot = projectsRef.current;
      const now = Date.now();
      let touched = false;
      const updated = snapshot.map((p) => {
        if (p.id !== projectId) return p;
        const layers = p.layers.map((l) => {
          if (l.id !== layerId) return l;
          touched = true;
          // Apply only defined keys: TS lets a caller pass `{ title: undefined }`
          // through Partial<>, and a bare `...patch` spread would overwrite a
          // required field with undefined (then persist it).
          return {
            ...l,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.turns !== undefined ? { turns: patch.turns } : {}),
            updatedAt: now,
          };
        });
        return touched ? { ...p, layers, updatedAt: now } : p;
      });
      if (!touched) return false;
      return commitLayerMutation(snapshot, updated);
    },
    [commitLayerMutation],
  );

  const removeLayer = useCallback(
    async (projectId: string, layerId: string): Promise<boolean> => {
      const snapshot = projectsRef.current;
      const now = Date.now();
      let touched = false;
      const updated = snapshot.map((p) => {
        if (p.id !== projectId) return p;
        const layers = p.layers.filter((l) => l.id !== layerId);
        if (layers.length === p.layers.length) return p;
        touched = true;
        return { ...p, layers, updatedAt: now };
      });
      if (!touched) return false;
      return commitLayerMutation(snapshot, updated);
    },
    [commitLayerMutation],
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
      addLayer: async () => null,
      updateLayer: async () => false,
      removeLayer: async () => false,
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
    addLayer,
    updateLayer,
    removeLayer,
    persistError,
    clearError,
  };
}
