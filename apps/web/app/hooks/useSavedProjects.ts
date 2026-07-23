"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type {
  SavedProject as BaseSavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  ProjectLayer,
  ProjectLayerTurn,
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
export type ProjectLayerPatch = Partial<
  Pick<ProjectLayer, "title" | "turns" | "status" | "maxRounds" | "link">
>;

/** A new session turn without the hook-stamped identity/timestamp. */
export type NewProjectLayerTurn = Omit<ProjectLayerTurn, "id" | "at">;

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
      // The wired IDB adapter returns a failed Result rather than throwing, but
      // treat a throwing port as a failed write too (mirrors commitLayerMutation):
      // otherwise the optimistic project stays in state after ManifestAcceptPage
      // catches the rejection and lets the user retry — the next save then
      // serializes the phantom project plus the retry, duplicating it.
      let result: Awaited<ReturnType<typeof port.saveProjects>>;
      try {
        result = await port.saveProjects(updated.map(toBase));
      } catch (e) {
        result = {
          success: false,
          error: {
            kind: "Unknown",
            message: "Unexpected error persisting the new project",
            cause: e,
          },
        };
      }
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

  // Fire-and-forget autosave with an optimistic local update, but the durable
  // write is RECORD-level (updateProjectRecord), not a whole-array save: a
  // saveProjects from this instance's snapshot could land AFTER a concurrent
  // read-merge-write (e.g. an in-flight live-session turn append) and silently
  // overwrite it with an array that predates the turn. The port re-reads at
  // write time and touches only this record, so both writers land regardless
  // of interleaving.
  const updateProject = useCallback(
    (id: string, formState: ProjectConfig, manifestYaml: string): void => {
      const snapshot = projectsRef.current;
      const now = Date.now();
      const updated = snapshot.map((p) =>
        p.id === id ? { ...p, formState, manifestYaml, updatedAt: now } : p,
      );
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated);
      void (async () => {
        // Same throwing-port hardening as commitRecordMutation below — an
        // escaped rejection from a fire-and-forget autosave is unreportable.
        let result: Awaited<ReturnType<typeof port.updateProjectRecord>>;
        try {
          result = await port.updateProjectRecord(id, (base) => ({
            ...base,
            formState,
            manifestYaml,
            updatedAt: now,
          }));
        } catch (e) {
          result = {
            success: false,
            error: {
              kind: "Unknown",
              message: "Unexpected error persisting the project",
              cause: e,
            },
          };
        }
        if (mutationSeq.current !== seq) return;
        if (!result.success) {
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
          return;
        }
        // Reconcile with the COMMITTED record: the port's read-merge-write may
        // have folded in sibling fields another writer landed first (a
        // live-session turn appended just before this autosave queued), which
        // the optimistic array above — built from this instance's snapshot —
        // cannot know about. Guarded by seq: a newer mutation owns state now.
        const committed = fromBase(result.value);
        const reconciled = projectsRef.current.map((p) =>
          p.id === id ? committed : p,
        );
        projectsRef.current = reconciled;
        setProjects(reconciled);
      })();
    },
    [port],
  );

  // Autosave for stepless field edits — the Plan-phase "Project settings" form
  // (Plan Workbench PR A1). Persists ONLY `formState`, leaving `manifestYaml`
  // and `layers` untouched, via the record-level read-merge-write port. This is
  // deliberately NOT `updateProject`: that regenerates `manifestYaml` from the
  // form (`wizardToManifest`), which is correct in the wizard but WRONG here,
  // where `manifestYaml` is the real generated architecture — a wizard
  // projection would silently overwrite it. Fire-and-forget with an optimistic
  // local update and a seq-guarded reconcile, mirroring `updateProject`'s
  // throwing-port + revert semantics. A `NotFound` (genesis/unknown/deleted id)
  // is an explicit no-op — no revert, no persistError — so a late-firing
  // debounced flush against a project that has since gone away stays silent
  // (matches the layer mutations' NotFound contract).
  const updateProjectFormState = useCallback(
    (id: string, formState: ProjectConfig): void => {
      const snapshot = projectsRef.current;
      // Unknown id (genesis/deleted): decide the no-op HERE, like the layer
      // mutations do, rather than letting the port's NotFound arm below catch
      // it. A no-op that bumped mutationSeq would mark an unrelated in-flight
      // mutation on this instance as stale and suppress its revert/reconcile.
      // The NotFound arm stays as the backstop for an id that exists locally
      // but has vanished from storage by write time.
      if (!snapshot.some((p) => p.id === id)) return;
      const now = Date.now();
      const updated = snapshot.map((p) =>
        p.id === id ? { ...p, formState, updatedAt: now } : p,
      );
      const seq = ++mutationSeq.current;
      projectsRef.current = updated;
      setProjects(updated);
      void (async () => {
        let result: Awaited<ReturnType<typeof port.updateProjectRecord>>;
        try {
          result = await port.updateProjectRecord(id, (base) => ({
            ...base,
            formState,
            updatedAt: now,
          }));
        } catch (e) {
          result = {
            success: false,
            error: {
              kind: "Unknown",
              message: "Unexpected error persisting the project settings",
              cause: e,
            },
          };
        }
        if (mutationSeq.current !== seq) return;
        if (!result.success) {
          if (result.error.kind === "NotFound") return;
          setProjects(snapshot);
          projectsRef.current = snapshot;
          setPersistError(result.error);
          return;
        }
        // Reconcile with the COMMITTED record — the port's read-merge-write may
        // have folded in sibling fields (e.g. a live-session turn appended just
        // before this autosave queued) that the optimistic array, built from
        // this instance's snapshot, cannot know about. Guarded by seq.
        const committed = fromBase(result.value);
        const reconciled = projectsRef.current.map((p) =>
          p.id === id ? committed : p,
        );
        projectsRef.current = reconciled;
        setProjects(reconciled);
      })();
    },
    [port],
  );

  // Persist a layer mutation AWAITED (the caller must know whether the write
  // landed — a session turn or pasted transcript is hard to reconstruct) and
  // CLOBBER-SAFE: through the port's read-merge-write `updateProjectRecord`,
  // which re-reads the stored array at write time and touches only this
  // record — a whole-array write from this instance's (possibly stale)
  // snapshot could silently revert other writers' records (the Phase-3
  // precondition; previously mitigated only by sharing one hook instance).
  // Local state is reconciled AFTER the durable write (no optimistic window),
  // so there is nothing to revert on failure. Returns the committed record,
  // or null on failure (NotFound — unknown/genesis project id — reports null
  // WITHOUT setting persistError, preserving addLayer's explicit-no-op
  // contract for genesis mode).
  const commitRecordMutation = useCallback(
    async (
      projectId: string,
      mutate: (project: SavedProject) => SavedProject,
    ): Promise<SavedProject | null> => {
      const seq = ++mutationSeq.current;
      // The wired IDB adapter returns a failed Result rather than throwing, but
      // treat a throwing port as a failed write too — an escaped rejection here
      // would blow past the dialog's inline error handling entirely.
      let result: Awaited<ReturnType<typeof port.updateProjectRecord>>;
      try {
        result = await port.updateProjectRecord(projectId, (base) => {
          const current = fromBase(base);
          const next = mutate(current);
          // Preserve the port's same-reference "no change" contract: mutate
          // returning its input unchanged must surface as the ORIGINAL base
          // reference (fromBase always allocates), so the adapter skips the write.
          return next === current ? base : toBase(next);
        });
      } catch (e) {
        result = {
          success: false,
          error: {
            kind: "Unknown",
            message: "Unexpected error persisting the layer mutation",
            cause: e,
          },
        };
      }
      if (!result.success) {
        if (result.error.kind !== "NotFound" && mutationSeq.current === seq) {
          setPersistError(result.error);
        }
        return null;
      }
      const committed = fromBase(result.value);
      // Reconcile this instance's snapshot with what was durably written (the
      // merged record may carry newer sibling fields than our snapshot had).
      const reconciled = projectsRef.current.map((p) =>
        p.id === projectId ? committed : p,
      );
      projectsRef.current = reconciled;
      setProjects(reconciled);
      return committed;
    },
    [port],
  );

  // Apply only defined keys: TS lets a caller pass `{ title: undefined }`
  // through Partial<>, and a bare `...patch` spread would overwrite a
  // required field with undefined (then persist it).
  const definedPatch = (patch: ProjectLayerPatch): Partial<ProjectLayer> => ({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.turns !== undefined ? { turns: patch.turns } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.maxRounds !== undefined ? { maxRounds: patch.maxRounds } : {}),
    ...(patch.link !== undefined ? { link: patch.link } : {}),
  });

  const addLayer = useCallback(
    async (
      projectId: string,
      layer: NewProjectLayer,
    ): Promise<string | null> => {
      const now = Date.now();
      const newLayer: ProjectLayer = {
        ...layer,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const committed = await commitRecordMutation(projectId, (p) => ({
        ...p,
        layers: [...p.layers, newLayer],
        updatedAt: now,
      }));
      return committed ? newLayer.id : null;
    },
    [commitRecordMutation],
  );

  const updateLayer = useCallback(
    async (
      projectId: string,
      layerId: string,
      patch: ProjectLayerPatch,
    ): Promise<boolean> => {
      const now = Date.now();
      let touched = false;
      const committed = await commitRecordMutation(projectId, (p) => {
        const layers = p.layers.map((l) => {
          if (l.id !== layerId) return l;
          touched = true;
          return { ...l, ...definedPatch(patch), updatedAt: now };
        });
        // Unknown layer id → same reference → the adapter skips the write.
        return touched ? { ...p, layers, updatedAt: now } : p;
      });
      return committed !== null && touched;
    },
    [commitRecordMutation],
  );

  // Append ONE turn to a layer against the FRESH stored record (plus an
  // optional same-write layer patch, e.g. the session status transition that
  // belongs atomically with the turn). This is the live-session write path:
  // per-turn writes must merge into storage, not replace the turn array from
  // a snapshot. Returns the COMMITTED turn (with its stamped id/at) so callers
  // mirror exactly what was persisted — re-stamping `at` caller-side would
  // diverge from storage. Null on failure/unknown ids.
  const appendLayerTurn = useCallback(
    async (
      projectId: string,
      layerId: string,
      turn: NewProjectLayerTurn,
      patch?: ProjectLayerPatch,
    ): Promise<ProjectLayerTurn | null> => {
      const now = Date.now();
      const newTurn: ProjectLayerTurn = {
        ...turn,
        id: crypto.randomUUID(),
        at: now,
      };
      let touched = false;
      const committed = await commitRecordMutation(projectId, (p) => {
        const layers = p.layers.map((l) => {
          if (l.id !== layerId) return l;
          touched = true;
          return {
            ...l,
            turns: [...l.turns, newTurn],
            ...(patch ? definedPatch(patch) : {}),
            updatedAt: now,
          };
        });
        return touched ? { ...p, layers, updatedAt: now } : p;
      });
      return committed !== null && touched ? newTurn : null;
    },
    [commitRecordMutation],
  );

  const removeLayer = useCallback(
    async (projectId: string, layerId: string): Promise<boolean> => {
      const now = Date.now();
      let touched = false;
      const committed = await commitRecordMutation(projectId, (p) => {
        const layers = p.layers.filter((l) => l.id !== layerId);
        if (layers.length === p.layers.length) return p;
        touched = true;
        return { ...p, layers, updatedAt: now };
      });
      return committed !== null && touched;
    },
    [commitRecordMutation],
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
      updateProjectFormState: () => {},
      addLayer: async () => null,
      updateLayer: async () => false,
      appendLayerTurn: async () => null,
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
    updateProjectFormState,
    addLayer,
    updateLayer,
    appendLayerTurn,
    removeLayer,
    persistError,
    clearError,
  };
}
