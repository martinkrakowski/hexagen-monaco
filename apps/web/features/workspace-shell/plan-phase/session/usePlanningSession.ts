"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectLayer, ProjectLayerTurn } from "@hexagen/shared";

import type {
  NewProjectLayer,
  NewProjectLayerTurn,
  ProjectLayerPatch,
} from "@/hooks/useSavedProjects";
import {
  DEFAULT_MAX_ROUNDS,
  initialSessionState,
  isActive,
  planningSessionReducer,
  roleForStatus,
  sessionStateFromLayer,
  type ModelRole,
  type PlanningSessionState,
} from "./planning-session";
import { buildFold } from "./fold";
import { parseVerdict } from "./verdict";
import { streamChatTurn } from "./stream-chat-turn";

import { MODEL_NAME } from "./model";

export interface StreamingDraft {
  readonly role: ModelRole;
  readonly content: string;
}

export interface UsePlanningSessionOptions {
  readonly projectId: string | null;
  // Layer mutations are INJECTED from the lifecycle hook (locked decision:
  // all layer writes flow through the single useProjectLifecycle instance).
  readonly addLayer: (
    projectId: string,
    layer: NewProjectLayer,
  ) => Promise<string | null>;
  // Returns the COMMITTED turn (persisted id/at) — the in-memory mirror must
  // carry the same timestamp storage got, not a re-stamped Date.now().
  readonly appendLayerTurn: (
    projectId: string,
    layerId: string,
    turn: NewProjectLayerTurn,
    patch?: ProjectLayerPatch,
  ) => Promise<ProjectLayerTurn | null>;
  readonly updateLayer: (
    projectId: string,
    layerId: string,
    patch: ProjectLayerPatch,
  ) => Promise<boolean>;
  readonly model?: string;
  readonly logger?: Pick<Console, "warn">;
}

export interface UsePlanningSessionReturn {
  /** null until a session is started or attached. */
  readonly sessionState: PlanningSessionState | null;
  readonly activeLayerId: string | null;
  /** The in-flight model turn (not yet persisted). */
  readonly draft: StreamingDraft | null;
  /** True while the client loop is driving model turns. */
  readonly isRunning: boolean;
  readonly seed: string;
  /** Resolves false when the session layer could not be created (the typed
   * brief must NOT be discarded — the caller surfaces an inline error). */
  start: (seed: string) => Promise<boolean>;
  /** Attach to a persisted (possibly interrupted) session layer. */
  attach: (layer: ProjectLayer) => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addSteering: (content: string) => Promise<void>;
  forceConverge: () => Promise<void>;
  end: () => Promise<void>;
  /** converged → finalizing (persisted). */
  beginFinalize: () => Promise<void>;
  /** finalizing → converged (finalize review cancelled/failed). */
  cancelFinalize: () => Promise<void>;
  /** Detach from a finished session so a new one can be started. The layer
   * stays persisted; only the hook's tracking is cleared. */
  reset: () => void;
  /** Persisted turns as the loop sees them (fresh, not render-cycle bound). */
  readonly turns: readonly ProjectLayerTurn[];
}

/**
 * Client-driven brainstorm loop (decided open question Q0): the browser tab
 * owns the proposer⇄critic loop — each model turn is one `/api/llm/chat`
 * request (quota applies per turn), streamed into a draft bubble, then
 * persisted as ONE layer turn via clobber-safe read-merge-write, then fed to
 * the pure reducer. If the tab dies mid-loop the persisted layer status stays
 * non-terminal and the UI offers Resume on next mount. Any error parks the
 * session in `awaiting-human` — never a silent stall.
 */
export function usePlanningSession(
  options: UsePlanningSessionOptions,
): UsePlanningSessionReturn {
  const { projectId, addLayer, appendLayerTurn, updateLayer } = options;
  const model = options.model ?? MODEL_NAME;
  // Default to console so the decided Q2 behavior (malformed verdict is
  // "treated as CONTINUE and logged") holds in the real app, where the
  // Plan-phase wiring injects no logger.
  const logger = options.logger ?? console;

  const [sessionState, setSessionState] = useState<PlanningSessionState | null>(
    null,
  );
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StreamingDraft | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [turns, setTurns] = useState<readonly ProjectLayerTurn[]>([]);
  const [seed, setSeed] = useState("");

  // Loop-owned mirrors: the async loop can't read React state mid-flight.
  const stateRef = useRef<PlanningSessionState | null>(null);
  const layerIdRef = useRef<string | null>(null);
  const turnsRef = useRef<readonly ProjectLayerTurn[]>([]);
  const seedRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic generation: bumping it supersedes (cancels) any running loop.
  const generationRef = useRef(0);
  // The turn persist currently in flight (if any). A superseding control
  // action (pause/force-converge/end) can land DURING the awaited
  // appendLayerTurn — the turn is then durably persisted but the superseded
  // loop must not apply it. The superseding action awaits this promise and
  // reconciles (pushTurn + advance state) so turnsRef matches storage and a
  // later resume can't re-run the already-persisted role.
  const pendingAppendRef = useRef<Promise<{
    turn: ProjectLayerTurn;
    next: PlanningSessionState;
  } | null> | null>(null);

  // Unmount teardown: the Plan phase is a conditional whole-shell swap, so
  // without this a phase switch/navigation leaves a headless "zombie" loop
  // streaming turns (burning quota) and writing to storage — and Resume from
  // the interrupted banner would then start a SECOND loop against the same
  // layer. Parking semantics are free: the persisted non-terminal status
  // already yields the interrupted banner on the next mount.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const applyState = useCallback((next: PlanningSessionState) => {
    stateRef.current = next;
    setSessionState(next);
  }, []);

  const pushTurn = useCallback((turn: ProjectLayerTurn) => {
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
  }, []);

  const persistStatus = useCallback(
    async (patch: ProjectLayerPatch): Promise<void> => {
      const layerId = layerIdRef.current;
      if (!projectId || !layerId) return;
      // Best-effort: a failed status write surfaces via the lifecycle hook's
      // persistError; the in-memory state machine still advanced, so the UI
      // stays controllable either way.
      await updateLayer(projectId, layerId, patch);
    },
    [projectId, updateLayer],
  );

  const failToAwaitingHuman = useCallback(
    async (message: string) => {
      const current = stateRef.current;
      if (!current) return;
      const next = planningSessionReducer(current, {
        type: "ERROR",
        message,
      });
      applyState(next);
      setDraft(null);
      await persistStatus({ status: next.status });
    },
    [applyState, persistStatus],
  );

  const runLoop = useCallback(async () => {
    if (!projectId) return;
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setIsRunning(true);
    try {
      for (;;) {
        const state = stateRef.current;
        const layerId = layerIdRef.current;
        if (!state || !layerId || !isCurrent()) return;
        if (!isActive(state.status)) return;
        const role = roleForStatus(state.status);
        if (!role) return;

        const fold = buildFold({
          role,
          seed: seedRef.current,
          turns: turnsRef.current,
          round: state.round,
          maxRounds: state.maxRounds,
        });

        setDraft({ role, content: "" });
        const abortController = new AbortController();
        abortRef.current = abortController;
        const result = await streamChatTurn({
          message: fold,
          model,
          signal: abortController.signal,
          onChunk: (content) => {
            if (isCurrent()) setDraft({ role, content });
          },
        });
        if (abortRef.current === abortController) abortRef.current = null;

        // Superseded (pause/force-converge/end already transitioned state).
        if (!isCurrent()) return;

        if (!result.ok) {
          if (result.aborted) return;
          await failToAwaitingHuman(result.error);
          return;
        }

        // Persist the completed turn WITH its status transition in one write.
        let event;
        if (role === "critic") {
          const parsed = parseVerdict(result.content);
          if (!parsed.explicit) {
            logger?.warn(
              "[planning-session] critic reply had no well-formed VERDICT line — treating as CONTINUE",
            );
          }
          event = { type: "CRITIQUE_DONE" as const, verdict: parsed.verdict };
        } else {
          event = { type: "PROPOSAL_DONE" as const };
        }
        const next = planningSessionReducer(state, event);
        const author = role === "critic" ? "Critic" : "Proposer";
        // Tracked in pendingAppendRef so a superseding control action that
        // lands DURING this await can reconcile the durable outcome.
        const appendPromise = (async () => {
          const turn = await appendLayerTurn(
            projectId,
            layerId,
            { author, content: result.content, role, round: state.round },
            { status: next.status },
          );
          if (turn === null) return null;
          return { turn, next };
        })();
        pendingAppendRef.current = appendPromise;
        const appended = await appendPromise;
        if (pendingAppendRef.current === appendPromise) {
          pendingAppendRef.current = null;
        }
        // Superseded mid-persist: the superseding action (which bumped the
        // generation synchronously before this continuation ran) owns the
        // reconciliation via the promise it captured — don't double-apply.
        if (!isCurrent()) return;
        if (appended === null) {
          await failToAwaitingHuman(
            "The turn could not be saved — the session is paused.",
          );
          return;
        }
        pushTurn(appended.turn);
        setDraft(null);
        applyState(appended.next);
      }
    } finally {
      if (generationRef.current === generation) {
        setIsRunning(false);
        setDraft(null);
      }
    }
  }, [
    projectId,
    model,
    logger,
    appendLayerTurn,
    applyState,
    pushTurn,
    failToAwaitingHuman,
  ]);

  const start = useCallback(
    async (seedText: string): Promise<boolean> => {
      const trimmed = seedText.trim();
      if (!projectId || !trimmed || stateRef.current !== null) return false;

      const initial = initialSessionState(DEFAULT_MAX_ROUNDS);
      const seedTurn: ProjectLayerTurn = {
        id: crypto.randomUUID(),
        author: "You",
        content: trimmed,
        role: "human",
        at: Date.now(),
      };
      const title = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
      // AWAITED create — the loop must not run against a layer that may not
      // have landed (the whole reason layer writes aren't fire-and-forget).
      const layerId = await addLayer(projectId, {
        kind: "brainstorm",
        title: `Live session: ${title}`,
        turns: [seedTurn],
        status: initial.status,
        maxRounds: initial.maxRounds,
      });
      // false = the caller must keep the typed brief and surface an error
      // (the lifecycle hook's persistError carries the failure detail).
      if (layerId === null) return false;

      layerIdRef.current = layerId;
      setActiveLayerId(layerId);
      seedRef.current = trimmed;
      setSeed(trimmed);
      turnsRef.current = [seedTurn];
      setTurns(turnsRef.current);
      applyState(initial);
      void runLoop();
      return true;
    },
    [projectId, addLayer, applyState, runLoop],
  );

  const attach = useCallback(
    (layer: ProjectLayer) => {
      // Attaching replaces any tracked session; supersede a running loop.
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRunning(false);
      setDraft(null);
      layerIdRef.current = layer.id;
      setActiveLayerId(layer.id);
      const seedTurn = layer.turns.find((t) => t.role === "human");
      seedRef.current = seedTurn?.content ?? "";
      setSeed(seedRef.current);
      turnsRef.current = layer.turns;
      setTurns(layer.turns);
      applyState(sessionStateFromLayer(layer));
    },
    [applyState],
  );

  // A control action can land while the loop is awaiting appendLayerTurn —
  // the turn IS (or is about to be) durable, so it must reach turnsRef and
  // advance the state before the control transition is computed; otherwise a
  // later resume re-runs the persisted role (duplicate turn) and the UI/fold
  // diverge from storage. Callers bump the generation BEFORE awaiting this,
  // so the superseded loop applies nothing itself.
  const settlePendingAppend = useCallback(async () => {
    const pending = pendingAppendRef.current;
    if (!pending) return;
    pendingAppendRef.current = null;
    const settled = await pending;
    if (settled) {
      pushTurn(settled.turn);
      applyState(settled.next);
    }
  }, [pushTurn, applyState]);

  const pause = useCallback(async () => {
    if (!stateRef.current) return;
    // Supersede the loop FIRST (synchronously) so it neither applies state
    // nor starts another stream, and abort any in-flight stream.
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setDraft(null);
    // Reconcile a turn persist the click may have interrupted.
    await settlePendingAppend();
    const current = stateRef.current;
    if (!current) return;
    const next = planningSessionReducer(current, { type: "PAUSE" });
    if (next === current) return; // e.g. the settled turn already converged
    applyState(next);
    await persistStatus({ status: next.status });
  }, [applyState, persistStatus, settlePendingAppend]);

  const resume = useCallback(async () => {
    const current = stateRef.current;
    if (!current || isRunning) return;
    const next = planningSessionReducer(current, { type: "RESUME" });
    if (next === current) return;
    applyState(next);
    await persistStatus({ status: next.status });
    void runLoop();
  }, [isRunning, applyState, persistStatus, runLoop]);

  const addSteering = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      const layerId = layerIdRef.current;
      if (!projectId || !layerId || !trimmed) return;
      const turn = await appendLayerTurn(projectId, layerId, {
        author: "You",
        content: trimmed,
        role: "human",
      });
      if (turn !== null) {
        pushTurn(turn);
      }
    },
    [projectId, appendLayerTurn, pushTurn],
  );

  const transitionAndStop = useCallback(
    async (event: { type: "FORCE_CONVERGE" } | { type: "END" }) => {
      if (!stateRef.current) return;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRunning(false);
      setDraft(null);
      // Reconcile a turn persist the click may have interrupted (see pause).
      await settlePendingAppend();
      const current = stateRef.current;
      if (!current) return;
      const next = planningSessionReducer(current, event);
      if (next === current) return;
      applyState(next);
      await persistStatus({ status: next.status });
    },
    [applyState, persistStatus, settlePendingAppend],
  );

  const forceConverge = useCallback(
    () => transitionAndStop({ type: "FORCE_CONVERGE" }),
    [transitionAndStop],
  );

  const end = useCallback(
    () => transitionAndStop({ type: "END" }),
    [transitionAndStop],
  );

  const beginFinalize = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const next = planningSessionReducer(current, { type: "FINALIZE_START" });
    if (next === current) return;
    applyState(next);
    await persistStatus({ status: next.status });
  }, [applyState, persistStatus]);

  // NOTE: there is deliberately no completeFinalize here. The source layer is
  // stamped done + linked by the import flow's accept-save (via the
  // originSession provenance) — i.e. only AFTER the hand-off actually
  // produced a manifest. Stamping at Confirm-time stranded a terminally
  // "done" layer whenever the navigation guard dialog was cancelled.

  const cancelFinalize = useCallback(async () => {
    const current = stateRef.current;
    if (!current || current.status !== "finalizing") return;
    const next: PlanningSessionState = { ...current, status: "converged" };
    applyState(next);
    await persistStatus({ status: "converged" });
  }, [applyState, persistStatus]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingAppendRef.current = null;
    setIsRunning(false);
    setDraft(null);
    stateRef.current = null;
    setSessionState(null);
    layerIdRef.current = null;
    setActiveLayerId(null);
    turnsRef.current = [];
    setTurns([]);
    seedRef.current = "";
    setSeed("");
  }, []);

  return {
    sessionState,
    activeLayerId,
    draft,
    isRunning,
    seed,
    turns,
    start,
    attach,
    pause,
    resume,
    addSteering,
    forceConverge,
    end,
    beginFinalize,
    cancelFinalize,
    reset,
  };
}
