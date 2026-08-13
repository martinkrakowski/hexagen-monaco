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

/** One record's in-flight bookkeeping entry. */
interface PendingRecordEntry {
  /** Stamp of the record's NEWEST op — the ownership token. */
  seq: number;
  /** In-flight op count; the entry is dropped when it reaches zero. */
  count: number;
}

/**
 * Per-record pending-operation tracker (PR #431 follow-up). Replaces the
 * global `mutationSeq` guard, which was whole-list: ANY newer mutation
 * suppressed a settling op's revert/reconcile, so a delete that failed after
 * an unrelated rename began never restored its row, and a failed create left
 * a phantom project in local state. Ops are now tracked per record id: a
 * settling op's revert/reconcile is suppressed only by a NEWER op on the SAME
 * record, and a list refresh overwrites only records with no concurrent
 * mutation.
 *
 * One monotonic clock stamps every event so three orderings stay comparable:
 * - op begin  → the op's `seq` (ownership token; the record's newest op wins),
 * - op settle → the record's `settled` stamp,
 * - refresh read start → compared against `settled` stamps at merge time (a
 *   refresh whose read STARTED before an op settled may carry data that
 *   predates that op's write, so the record keeps its local value).
 *
 * `pending` entries are removed when their count reaches zero; `settled`
 * stamps live for the hook instance's lifetime — intentional, bounded by the
 * number of distinct record ids mutated in a session.
 */
interface RecordOpTracker {
  /** Register a new op on `id`; returns its ownership token. */
  begin(id: string): number;
  /** True while `seq` is still the record's newest op. */
  owns(id: string, seq: number): boolean;
  /** Mark one op on `id` as settled (success OR failure). */
  settle(id: string): void;
  /** True while any op on `id` is in flight. */
  has(id: string): boolean;
  /** True if an op on `id` settled after the given clock stamp. */
  settledAfter(id: string, stamp: number): boolean;
  /** Current clock value (for stamping a refresh's read start). */
  now(): number;
}

function createRecordOpTracker(): RecordOpTracker {
  let clock = 0;
  const pending = new Map<string, PendingRecordEntry>();
  const settled = new Map<string, number>();
  return {
    begin(id) {
      const seq = ++clock;
      const entry = pending.get(id);
      if (entry) {
        entry.seq = seq;
        entry.count += 1;
      } else {
        pending.set(id, { seq, count: 1 });
      }
      return seq;
    },
    owns(id, seq) {
      return pending.get(id)?.seq === seq;
    },
    settle(id) {
      settled.set(id, ++clock);
      const entry = pending.get(id);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) pending.delete(id);
    },
    has(id) {
      return pending.has(id);
    },
    settledAfter(id, stamp) {
      return (settled.get(id) ?? 0) > stamp;
    },
    now() {
      return clock;
    },
  };
}

/**
 * Merge a freshly loaded list into the current local list. Fresh (storage)
 * values win for untouched records; `keepLocal` records keep their local
 * value — INCLUDING local absence (a pending delete stays deleted even if the
 * refresh read still saw the row) and local presence (a pending create
 * survives a read that missed it; such records are prepended in local order,
 * matching creation's prepend). Records present on both sides keep the fresh
 * list's ordering.
 */
function mergeFreshProjects(
  local: readonly SavedProject[],
  fresh: readonly SavedProject[],
  keepLocal: (id: string) => boolean,
): SavedProject[] {
  const localById = new Map(local.map((p) => [p.id, p] as const));
  const freshIds = new Set(fresh.map((p) => p.id));
  const merged: SavedProject[] = [];
  for (const p of local) {
    if (!freshIds.has(p.id) && keepLocal(p.id)) merged.push(p);
  }
  for (const f of fresh) {
    if (!keepLocal(f.id)) {
      merged.push(f);
      continue;
    }
    const localValue = localById.get(f.id);
    if (localValue) merged.push(localValue);
    // kept-local but locally absent → a pending/just-settled delete: the
    // local absence wins over the fresh row.
  }
  return merged;
}

export function useSavedProjects() {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [persistError, setPersistError] = useState<PersistenceError | null>(
    null,
  );
  const projectsRef = useRef(projects);
  // Lazy useState (not useRef) so the tracker is created exactly once per hook
  // instance — intentional: it is mutable bookkeeping read/written inside
  // async closures; no render output depends on it, so React state/effects are
  // the wrong home for it.
  const [recordOps] = useState(createRecordOpTracker);
  // Monotonic ticket so only the LATEST load/refresh may apply its result —
  // an older read applying after a newer one would reintroduce stale rows.
  const refreshTicket = useRef(0);

  const port: SavedProjectsPersistencePort = getSavedProjectsPersistence();

  // Replace ONE record in local state (settle-time revert/reconcile). Reads
  // projectsRef.current — NOT a fire-time snapshot — deliberately: at settle
  // time other records may carry newer optimistic values that a whole-array
  // snapshot restore would clobber (the defect the per-record tracking fixes).
  const replaceRecord = useCallback((id: string, value: SavedProject): void => {
    const next = projectsRef.current.map((p) => (p.id === id ? value : p));
    projectsRef.current = next;
    setProjects(next);
  }, []);

  const applyFreshProjects = useCallback(
    (fresh: SavedProject[], readStamp: number): void => {
      const next = mergeFreshProjects(
        projectsRef.current,
        fresh,
        // Keep the local value while an op is in flight, and ALSO when an op
        // settled after this refresh's read began: the read may predate that
        // op's write, and the settle-time reconcile already made local right.
        (id) => recordOps.has(id) || recordOps.settledAfter(id, readStamp),
      );
      projectsRef.current = next;
      setProjects(next);
    },
    [recordOps],
  );

  /**
   * Re-read the stored list and merge it per-record: untouched records take
   * the fresh stored value; records with a pending (or refresh-concurrent)
   * mutation keep their local value until their op settles. A failed read
   * leaves local state untouched (matching the mount load's contract).
   */
  const refreshProjects = useCallback(async (): Promise<void> => {
    const ticket = ++refreshTicket.current;
    const readStamp = recordOps.now();
    await getMigrationReady();
    const result = await port.loadProjects();
    if (result.success && ticket === refreshTicket.current) {
      applyFreshProjects(result.value.map(fromBase), readStamp);
    }
  }, [port, recordOps, applyFreshProjects]);

  useEffect(() => {
    setMounted(true);
    const load = async () => {
      // The mount load goes through the same per-record merge as refreshes: a
      // mutation fired before the initial read resolves (e.g. saveProject from
      // the name step) is no longer clobbered by the late whole-list apply.
      await refreshProjects();
      setIsLoading(false);
    };
    load();
  }, [refreshProjects]);

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
      const seq = recordOps.begin(id);
      const updated = [newProject, ...projectsRef.current];
      projectsRef.current = updated;
      setProjects(updated); // optimistic; the record is dropped below if the write fails
      // Await the persistence write so callers can navigate only after the
      // project is durably committed (the IndexedDB adapter is async).
      // Returning the id before the write resolved caused approved projects to
      // be "lost" when the next screen read storage before the write landed.
      // The write is RECORD-level (createProjectRecord: fresh read at write
      // time, duplicate-id reject, prepend) — a whole-array save from this
      // instance's snapshot could revert records other writers just committed
      // (ADR-0045's clobber class).
      // The wired IDB adapter returns a failed Result rather than throwing, but
      // treat a throwing port as a failed write too (mirrors commitRecordMutation):
      // otherwise the optimistic project stays in state after ManifestAcceptPage
      // catches the rejection and lets the user retry — the next save then
      // persists the phantom project plus the retry, duplicating it.
      let result: Awaited<ReturnType<typeof port.createProjectRecord>>;
      try {
        result = await port.createProjectRecord(toBase(newProject));
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
      // Ownership is read BEFORE settling (settle clears the pending entry).
      const owner = recordOps.owns(id, seq);
      recordOps.settle(id);
      if (!result.success) {
        if (owner) {
          // Per-record revert: drop ONLY the optimistic create from the
          // CURRENT array. The old whole-snapshot restore would clobber other
          // records' newer optimistic values — and the old global seq guard
          // suppressed the revert entirely once ANY later mutation began,
          // leaving the phantom project in state.
          const next = projectsRef.current.filter((p) => p.id !== id);
          projectsRef.current = next;
          setProjects(next);
          setPersistError(result.error);
        }
        return null;
      }
      return id;
    },
    [port, recordOps],
  );

  const loadProject = useCallback(
    (id: string): SavedProject | undefined => {
      return projects.find((p) => p.id === id);
    },
    [projects],
  );

  // Fire-and-forget with an optimistic removal and a per-record,
  // ownership-guarded revert, but the durable write is RECORD-level
  // (deleteProjectRecord), not a whole-array save of the filtered snapshot —
  // which could silently revert every other record to this instance's stale
  // view. The port method is IDEMPOTENT (absent id resolves success), which is
  // load-bearing here: if "already deleted elsewhere" surfaced as an error,
  // the revert arm below would resurrect the locally-deleted row (port D6).
  const deleteProject = useCallback(
    (id: string): void => {
      const current = projectsRef.current;
      const index = current.findIndex((p) => p.id === id);
      const removed = index === -1 ? undefined : current[index];
      const seq = recordOps.begin(id);
      const updated = current.filter((p) => p.id !== id);
      projectsRef.current = updated;
      setProjects(updated);
      void (async () => {
        // Same throwing-port hardening as the other writers — an escaped
        // rejection from a fire-and-forget delete is unreportable.
        let result: Awaited<ReturnType<typeof port.deleteProjectRecord>>;
        try {
          result = await port.deleteProjectRecord(id);
        } catch (e) {
          result = {
            success: false,
            error: {
              kind: "Unknown",
              message: "Unexpected error deleting the project",
              cause: e,
            },
          };
        }
        const owner = recordOps.owns(id, seq);
        recordOps.settle(id);
        if (!result.success && owner) {
          if (removed) {
            // Per-record revert: re-insert ONLY the removed row, best-effort
            // at its old position (the list may have gained or lost OTHER rows
            // while the delete was in flight — the row's presence is the
            // correctness guarantee, not its exact slot). Unlike the old
            // global guard, a later mutation on a DIFFERENT record no longer
            // suppresses this restore.
            const next = [...projectsRef.current];
            next.splice(Math.min(index, next.length), 0, removed);
            projectsRef.current = next;
            setProjects(next);
          }
          setPersistError(result.error);
        }
      })();
    },
    [port, recordOps],
  );

  // Fire-and-forget rename through the record-level read-merge-write port —
  // a whole-array save from this instance's snapshot could revert sibling
  // fields (layers, githubLink) other writers just committed. NotFound
  // (project deleted from storage between snapshot and write) is a silent
  // no-op — no revert, no persistError — matching updateProjectFormState's
  // NotFound contract; failures revert ONLY this record, ownership-guarded.
  const renameProject = useCallback(
    (id: string, newName: string): void => {
      const current = projectsRef.current;
      // Unknown id: decide the no-op HERE (like updateProjectFormState) so no
      // pointless port write fires; `prev` doubles as the per-record revert
      // value. (With per-record tracking a ghost-id op can no longer disturb
      // an unrelated in-flight mutation's guard, but the no-write contract
      // stands.)
      const prev = current.find((p) => p.id === id);
      if (!prev) return;
      const now = Date.now();
      const seq = recordOps.begin(id);
      const updated = current.map((p) =>
        p.id === id ? { ...p, name: newName, updatedAt: now } : p,
      );
      projectsRef.current = updated;
      setProjects(updated);
      void (async () => {
        let result: Awaited<ReturnType<typeof port.updateProjectRecord>>;
        try {
          result = await port.updateProjectRecord(id, (base) => ({
            ...base,
            name: newName,
            updatedAt: now,
          }));
        } catch (e) {
          result = {
            success: false,
            error: {
              kind: "Unknown",
              message: "Unexpected error renaming the project",
              cause: e,
            },
          };
        }
        // Only a NEWER op on THIS record suppresses the revert/reconcile —
        // mutations on other records no longer do (the global guard's defect).
        const owner = recordOps.owns(id, seq);
        recordOps.settle(id);
        if (!owner) return;
        if (!result.success) {
          if (result.error.kind === "NotFound") return;
          replaceRecord(id, prev);
          setPersistError(result.error);
          return;
        }
        // Reconcile with the COMMITTED record — the read-merge-write may have
        // folded in sibling fields another writer landed first.
        replaceRecord(id, fromBase(result.value));
      })();
    },
    [port, recordOps, replaceRecord],
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
      const current = projectsRef.current;
      // Pre-op value for the per-record revert; may be undefined for an id
      // this instance never had — the failure still surfaces below.
      const prev = current.find((p) => p.id === id);
      const now = Date.now();
      const seq = recordOps.begin(id);
      const updated = current.map((p) =>
        p.id === id ? { ...p, formState, manifestYaml, updatedAt: now } : p,
      );
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
        const owner = recordOps.owns(id, seq);
        recordOps.settle(id);
        if (!owner) return;
        if (!result.success) {
          if (prev) replaceRecord(id, prev);
          setPersistError(result.error);
          return;
        }
        // Reconcile with the COMMITTED record: the port's read-merge-write may
        // have folded in sibling fields another writer landed first (a
        // live-session turn appended just before this autosave queued), which
        // the optimistic array above — built from this instance's snapshot —
        // cannot know about. Ownership-guarded: a newer op on this record owns
        // its state now.
        replaceRecord(id, fromBase(result.value));
      })();
    },
    [port, recordOps, replaceRecord],
  );

  // Autosave for stepless field edits — the Plan-phase "Project settings" form
  // (Plan Workbench PR A1). Persists ONLY `formState`, leaving `manifestYaml`
  // and `layers` untouched, via the record-level read-merge-write port. This is
  // deliberately NOT `updateProject`: that regenerates `manifestYaml` from the
  // form (`wizardToManifest`), which is correct in the wizard but WRONG here,
  // where `manifestYaml` is the real generated architecture — a wizard
  // projection would silently overwrite it. Fire-and-forget with an optimistic
  // local update and an ownership-guarded per-record reconcile, mirroring
  // `updateProject`'s throwing-port + revert semantics. A `NotFound`
  // (genesis/unknown/deleted id) is an explicit no-op — no revert, no
  // persistError — so a late-firing debounced flush against a project that has
  // since gone away stays silent (matches the layer mutations' NotFound
  // contract).
  const updateProjectFormState = useCallback(
    (id: string, formState: ProjectConfig): void => {
      const current = projectsRef.current;
      // Unknown id (genesis/deleted): decide the no-op HERE, like the layer
      // mutations do, rather than letting the port's NotFound arm below catch
      // it — no pointless port write fires, and `prev` doubles as the
      // per-record revert value. The NotFound arm stays as the backstop for an
      // id that exists locally but has vanished from storage by write time.
      const prev = current.find((p) => p.id === id);
      if (!prev) return;
      const now = Date.now();
      const seq = recordOps.begin(id);
      const updated = current.map((p) =>
        p.id === id ? { ...p, formState, updatedAt: now } : p,
      );
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
        const owner = recordOps.owns(id, seq);
        recordOps.settle(id);
        if (!owner) return;
        if (!result.success) {
          if (result.error.kind === "NotFound") return;
          replaceRecord(id, prev);
          setPersistError(result.error);
          return;
        }
        // Reconcile with the COMMITTED record — the port's read-merge-write may
        // have folded in sibling fields (e.g. a live-session turn appended just
        // before this autosave queued) that the optimistic array, built from
        // this instance's snapshot, cannot know about. Ownership-guarded.
        replaceRecord(id, fromBase(result.value));
      })();
    },
    [port, recordOps, replaceRecord],
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
      const seq = recordOps.begin(projectId);
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
      const owner = recordOps.owns(projectId, seq);
      recordOps.settle(projectId);
      if (!result.success) {
        if (result.error.kind !== "NotFound" && owner) {
          setPersistError(result.error);
        }
        return null;
      }
      const committed = fromBase(result.value);
      // Reconcile this instance's snapshot with what was durably written (the
      // merged record may carry newer sibling fields than our snapshot had).
      // Ownership-guarded: if a NEWER op on this record fired meanwhile, its
      // settle brings a newer committed value — reconciling here would clobber
      // that op's optimistic state with an older read. The committed record is
      // still RETURNED regardless: the write itself landed.
      if (owner) replaceRecord(projectId, committed);
      return committed;
    },
    [port, recordOps, replaceRecord],
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
      refreshProjects: async () => {},
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
    refreshProjects,
    addLayer,
    updateLayer,
    appendLayerTurn,
    removeLayer,
    persistError,
    clearError,
  };
}
