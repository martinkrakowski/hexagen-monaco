"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { BrownfieldFlowViewState } from "../BrownfieldFlow/types";
import {
  fromBrownfieldDraft,
  getBrownfieldDraftStore,
  toBrownfieldDraft,
  type BrownfieldDraft,
} from "./brownfield-draft";

export interface BrownfieldDraftHandle {
  /**
   * The recovered draft, or null when there is nothing to recover.
   *
   * ALSO null on the server and during the hydration render — see the SSR note
   * on the hook. Callers must therefore treat "no draft yet" as a state that
   * can flip once, not as a settled answer, and must not decide anything
   * irreversible (a redirect, a wipe) on the first render's null.
   */
  restoredDraft: BrownfieldDraft | null;
  /**
   * `restoredDraft` projected back onto the flow's view state, with the resume
   * point clamped and every non-persisted field explicitly nulled. Safe to
   * spread over a fresh view state.
   */
  restoredView: BrownfieldFlowViewState | null;
  saveDraft: (view: BrownfieldFlowViewState) => void;
  discardDraft: () => void;
}

/**
 * Reads and writes the brownfield draft for one flow seed.
 *
 * ## SSR and hydration
 *
 * This is an App Router client component hook, which still means it renders on
 * the SERVER first, where `localStorage` does not exist. Two things keep that
 * honest:
 *
 *  1. The store handed out during server render is inert (see
 *     `getBrownfieldDraftStore`), and `createPersistedStorage` no-ops without
 *     `window` regardless — so nothing here touches `localStorage` on the
 *     server, and no read or write path can throw there.
 *
 *  2. `useSyncExternalStore` is given a `getServerSnapshot` that returns a
 *     stable `null`. React uses that snapshot for BOTH the server render and
 *     the client's hydration render, so the two agree by construction; only
 *     after hydration commits does React read the client snapshot and re-render
 *     with the recovered draft. That is what makes this hydration-safe without
 *     a `useState(false)` + `useEffect` "mounted" dance, and it is the reason
 *     `restoredDraft` is documented as flipping exactly once.
 *
 * ## Storage that throws
 *
 * Private-browsing modes and blocked site-data settings make `localStorage`
 * access THROW rather than return null. Every path in this hook goes through
 * `createPersistedStorage`, whose read and write are both wrapped in
 * `try { … } catch { }` around the property access itself — so in those
 * browsers the hook degrades to "no draft, saves silently discarded" and the
 * flow renders exactly as it does for a first-time visitor. There is no
 * `localStorage` reference anywhere in this slice to bypass that.
 */
export function useBrownfieldDraft(
  seedName: string | null,
): BrownfieldDraftHandle {
  const store = useMemo(() => getBrownfieldDraftStore(seedName), [seedName]);

  const restoredDraft = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.readServer,
  );

  useEffect(() => {
    // Discard-and-start-clean, completed. `read()` already returns null for an
    // unrecognised blob (wrong `schemaVersion`, failed validation, expired,
    // wrong seed), but the blob itself would otherwise sit under the key
    // forever, re-parsed on every visit. The `PersistedStorage` API cannot
    // distinguish "absent" from "rejected" without a raw `localStorage` read,
    // which this slice deliberately does not do — so clear whenever the read
    // comes back empty. `removeItem` on an absent key is a no-op, and the
    // resulting notification resolves to the same `null` snapshot, so React
    // bails out of the re-render instead of looping.
    if (store.read() === null) store.clear();
  }, [store]);

  const restoredView = useMemo(
    () => (restoredDraft === null ? null : fromBrownfieldDraft(restoredDraft)),
    [restoredDraft],
  );

  const saveDraft = useCallback(
    (view: BrownfieldFlowViewState) => {
      store.save(toBrownfieldDraft(seedName, view));
    },
    [store, seedName],
  );

  const discardDraft = useCallback(() => {
    store.clear();
  }, [store]);

  return useMemo(
    () => ({ restoredDraft, restoredView, saveDraft, discardDraft }),
    [restoredDraft, restoredView, saveDraft, discardDraft],
  );
}
