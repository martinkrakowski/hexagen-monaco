"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlanningSessionSnapshot } from "./planning-session";
import { streamChatTurn } from "./stream-chat-turn";
import { buildDistillPrompt, stripYamlFences } from "./distill";
import { MODEL_NAME } from "./model";

/**
 * Finalize UI state, LIFTED out of the live panel (Plan Workbench A2): the
 * workbench's right pane switches between a live view and archived-layer
 * readers, and a view switch unmounts the live panel — component-local
 * finalize state (and the distill abort ref) would be lost mid-distill /
 * mid-review. This hook is mounted at the plan host across view switches, so
 * finalize progress survives them.
 */
export type FinalizeUiState =
  | { readonly phase: "idle" }
  | { readonly phase: "distilling"; readonly content: string }
  | { readonly phase: "review"; readonly text: string }
  | { readonly phase: "error"; readonly message: string };

export interface UsePlanningFinalizeOptions {
  /**
   * Ref-fresh read of the tracked session (null when none). Deliberately a
   * GETTER rather than a render value: `start()` runs from a click handler and
   * must gate on the status the session hook actually holds, and fold the
   * transcript storage actually has.
   */
  readonly readSession: () => PlanningSessionSnapshot | null;
  /**
   * Monotonic counter the session hook bumps whenever the tracked session is
   * DISCARDED (attach / end / reset). This is the ONLY inbound control seam:
   * the session hook does not know this hook exists, and this hook does not
   * reach into the loop's refs. A change tears down the review and aborts an
   * in-flight distill, which is what stops an ended session's distill from
   * completing into a review whose Confirm has no layer left to link.
   */
  readonly discardEpoch: number;
  /** converged → finalizing (persisted by the session hook). */
  readonly beginFinalize: () => Promise<void>;
  /** finalizing → converged (persisted by the session hook). */
  readonly cancelFinalize: () => Promise<void>;
  readonly model?: string;
}

export interface UsePlanningFinalizeReturn {
  /** Lifted finalize UI state — survives right-pane view switches. */
  readonly state: FinalizeUiState;
  /** converged → distill stream → editable review (or error + auto-cancel). */
  readonly start: () => Promise<void>;
  /** Abort any in-flight distill, drop the review, return to converged. */
  readonly abandon: () => Promise<void>;
  /** Edit the distilled spec while in the review phase (no-op otherwise). */
  readonly setReviewText: (text: string) => void;
}

/**
 * Finalize (decided open question Q4): ONE stateless chat call distills the
 * converged session into importable spec text, reviewed by the human before an
 * explicit confirm hands off to the import flow (owned by the caller).
 *
 * GOD-007 / item 8.6: this used to be four members of `usePlanningSession`,
 * which already owned the proposer⇄critic loop, the layer-turn persistence and
 * the session control plane. Nothing here touches the loop — no generation
 * counter, no pending-append reconcile, no turn writes — and nothing in the
 * loop hook can reach back in (`UsePlanningSessionReturn` declares the four
 * finalize members `?: never`, and `apps/web/eslint.config.js` fences the
 * `session/` directory off from this module and from `./distill`).
 */
export function usePlanningFinalize(
  options: UsePlanningFinalizeOptions,
): UsePlanningFinalizeReturn {
  const { readSession, discardEpoch, beginFinalize, cancelFinalize } = options;
  const model = options.model ?? MODEL_NAME;

  const [state, setState] = useState<FinalizeUiState>({ phase: "idle" });
  // The distill's own abort controller. Doubles as the re-entrancy guard for
  // start() (claimed SYNCHRONOUSLY before its first await), and lets
  // abandon/discard/unmount kill an in-flight distill stream.
  const distillAbortRef = useRef<AbortController | null>(null);

  const teardown = useCallback(() => {
    distillAbortRef.current?.abort();
    distillAbortRef.current = null;
    setState({ phase: "idle" });
  }, []);

  // Unmount teardown: without this, a phase switch/navigation leaves a
  // headless distill streaming (burning quota). No setState here — the hook is
  // going away. The layer keeps its persisted "finalizing" status; on the next
  // attach `sessionStateFromLayer` recovers it as converged, so Finalize is
  // simply re-runnable.
  useEffect(() => {
    return () => {
      distillAbortRef.current?.abort();
      distillAbortRef.current = null;
    };
  }, []);

  // Discard reconcile. The comparison against the last SEEN epoch is the
  // load-bearing part, not the dependency array: today's deps happen to be
  // stable, so React would skip the effect anyway, but ANY future re-run for a
  // non-discard reason (a dependency added here or to `teardown`, a
  // StrictMode remount) would otherwise wipe a live review — the exact lift
  // this hook exists to provide. Keyed on the VALUE, so only a real discard
  // tears down.
  const seenEpochRef = useRef(discardEpoch);
  useEffect(() => {
    if (seenEpochRef.current === discardEpoch) return;
    seenEpochRef.current = discardEpoch;
    teardown();
  }, [discardEpoch, teardown]);

  const start = useCallback(async () => {
    const snapshot = readSession();
    if (!snapshot || snapshot.status !== "converged") return;
    // Re-entrancy guard, claimed SYNCHRONOUSLY before the first await: the
    // Finalize button stays clickable through `await beginFinalize()`, so a
    // double-click would otherwise start two concurrent distills.
    if (distillAbortRef.current) return;
    const abortController = new AbortController();
    distillAbortRef.current = abortController;
    await beginFinalize();
    // Abandoned/discarded while beginFinalize was in flight — that path already
    // reset the UI; don't flash "distilling" over it.
    if (abortController.signal.aborted) return;
    setState({ phase: "distilling", content: "" });
    const result = await streamChatTurn({
      message: buildDistillPrompt({
        seed: snapshot.seed,
        turns: snapshot.turns,
      }),
      model,
      signal: abortController.signal,
      onChunk: (content) => setState({ phase: "distilling", content }),
    });
    // Only clear the ref if it is still OURS: an abandon+restart during the
    // await means a newer distill owns it now, and wiping that controller
    // would make the new run uncancellable.
    if (distillAbortRef.current === abortController) {
      distillAbortRef.current = null;
    }
    if (!result.ok) {
      if (result.aborted) return; // abandoned — teardown already handled it
      setState({ phase: "error", message: result.error });
      await cancelFinalize();
      return;
    }
    setState({ phase: "review", text: stripYamlFences(result.content) });
  }, [readSession, beginFinalize, cancelFinalize, model]);

  const abandon = useCallback(async () => {
    teardown();
    await cancelFinalize();
  }, [teardown, cancelFinalize]);

  const setReviewText = useCallback((text: string) => {
    // Guarded to the review phase so a stale keystroke (e.g. flushed after an
    // abandon) can't resurrect a dropped review.
    setState((prev) =>
      prev.phase === "review" ? { phase: "review", text } : prev,
    );
  }, []);

  return { state, start, abandon, setReviewText };
}
