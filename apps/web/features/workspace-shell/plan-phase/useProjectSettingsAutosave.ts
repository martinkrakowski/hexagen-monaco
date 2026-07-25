"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

/**
 * Debounce window for the on-change autosave. Short enough that an edit is
 * durable a beat after the user pauses, long enough to coalesce a burst of
 * keystrokes into a single write. Blur and unmount both flush immediately, so
 * this is only the "still actively typing" ceiling.
 */
export const PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS = 500;

interface UseProjectSettingsAutosaveOptions {
  /**
   * The saved project the edits persist to. `null` disables the autosave
   * entirely (genesis / no project): nothing is watched and nothing flushes.
   */
  projectId: string | null;
  form: UseFormReturn<ProjectConfig>;
  /** Record-level, formState-only persist (`updateProjectFormState`). */
  persist: (id: string, formState: ProjectConfig) => void;
  debounceMs?: number;
}

/**
 * Persists stepless Plan-phase "Project settings" edits.
 *
 * The wizard only writes on step navigation (`handleNext` / `handleSaveAndNew`);
 * a stepless workbench never fires those, so field edits would silently never
 * persist without this. Strategy: debounce on change, flush on blur, flush on
 * unmount (a phase switch unmounts the plan host), plus a best-effort
 * `beforeunload` flush.
 *
 * Only a NAMED field change counts as a user edit — react-hook-form's `reset()`
 * (project load / mode switch) fires the watcher with `name === undefined`, and
 * persisting on that would write the just-loaded values straight back and,
 * worse, mark a pristine form dirty. A reset also SUPERSEDES any pending edit:
 * the watcher drops the un-flushed timer and dirty flag, because a flush that
 * runs after the reset reads getValues() at fire time and would persist the
 * post-reset values over whatever the resetter just saved.
 *
 * Returns `flush` so the host can wire it to a section-level blur (focusout).
 */
export function useProjectSettingsAutosave({
  projectId,
  form,
  persist,
  debounceMs = PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS,
}: UseProjectSettingsAutosaveOptions): { flush: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // Hold the moving parts in refs so `flush`'s identity stays stable (it feeds
  // long-lived window listeners and is returned to the host) while always
  // reading the latest projectId / persist / form without re-subscribing.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const formRef = useRef(form);
  formRef.current = form;

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    const id = projectIdRef.current;
    if (!id) return;
    dirtyRef.current = false;
    persistRef.current(id, formRef.current.getValues());
  }, []);

  // Subscribe to form changes. `watch(cb)` does NOT fire on subscribe, so mount
  // is safe; it fires on every field change thereafter.
  //
  // LAYOUT effect, deliberately: the fields are interactive the moment they
  // commit, so edit capture must be live in that same commit. As a passive
  // effect this subscription landed one Scheduler task later, and an edit
  // dispatched inside that gap (automation typing the instant the input
  // appears — the form-seam suite reproduced this under load) was PERMANENTLY
  // lost: watch(cb) doesn't replay past changes, so dirtyRef never armed and
  // every later flush no-opped. No SSR concern: the section only renders after
  // the client-only port load supplies a project.
  useLayoutEffect(() => {
    if (!projectId) return;
    const subscription = form.watch((_values, info) => {
      // A programmatic reset (project load / mode switch) is not a user edit —
      // and it supersedes any pending one. Beyond not scheduling a write, drop
      // a prior edit's timer and dirty flag: flush reads getValues() at fire
      // time, so a debounce timer surviving the reset would persist the
      // POST-reset values (e.g. emptyFormValues after Save & New) over the
      // formState the resetter just saved.
      if (info?.name === undefined) {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        dirtyRef.current = false;
        return;
      }
      dirtyRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, debounceMs);
    });
    return () => subscription.unsubscribe();
  }, [projectId, form, debounceMs, flush]);

  // Flush a pending edit on unmount (a phase switch unmounts the plan host) and
  // on a best-effort `beforeunload`. IndexedDB can't complete synchronously in
  // `beforeunload`, but the write is issued immediately and typically lands;
  // blur + the short debounce keep the unpersisted window small regardless.
  useEffect(() => {
    if (!projectId) return;
    const onBeforeUnload = () => flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Boundary guard (pre-emptive hardening — not reachable today): on a
      // plain unmount, projectIdRef still holds this closure's id and the
      // pending edit flushes to the right project. But on an IN-PLACE id
      // switch (A→B rerender without unmount), the ref was reassigned to B
      // during render BEFORE this cleanup runs — flushing here would write
      // A's pending edit into B. No live UI performs an in-place switch yet
      // (project load is a full navigation/remount), but the Plan Workbench
      // arc adds shell consumers, so guard the boundary now: drop the stale
      // edit, including the surviving debounce timer, which would otherwise
      // fire later against B.
      if (projectIdRef.current === projectId) {
        flush();
      } else {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        dirtyRef.current = false;
      }
    };
  }, [projectId, flush]);

  return { flush };
}
