"use client";

import { useCallback, useRef, useState } from "react";
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

const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

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
  readonly appendLayerTurn: (
    projectId: string,
    layerId: string,
    turn: NewProjectLayerTurn,
    patch?: ProjectLayerPatch,
  ) => Promise<string | null>;
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
  start: (seed: string) => Promise<void>;
  /** Attach to a persisted (possibly interrupted) session layer. */
  attach: (layer: ProjectLayer) => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addSteering: (content: string) => Promise<void>;
  forceConverge: () => Promise<void>;
  end: () => Promise<void>;
  /** converged → finalizing (persisted). */
  beginFinalize: () => Promise<void>;
  /** finalizing → done, stamping the produced-manifest link. */
  completeFinalize: () => Promise<void>;
  /** finalizing → converged (finalize review cancelled/failed). */
  cancelFinalize: () => Promise<void>;
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
  const { projectId, addLayer, appendLayerTurn, updateLayer, logger } = options;
  const model = options.model ?? MODEL_NAME;

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
        const turnId = await appendLayerTurn(
          projectId,
          layerId,
          {
            author: role === "critic" ? "Critic" : "Proposer",
            content: result.content,
            role,
            round: state.round,
          },
          { status: next.status },
        );
        if (!isCurrent()) return;
        if (turnId === null) {
          await failToAwaitingHuman(
            "The turn could not be saved — the session is paused.",
          );
          return;
        }
        pushTurn({
          id: turnId,
          author: role === "critic" ? "Critic" : "Proposer",
          content: result.content,
          role,
          round: state.round,
          at: Date.now(),
        });
        setDraft(null);
        applyState(next);
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
    async (seedText: string) => {
      const trimmed = seedText.trim();
      if (!projectId || !trimmed || stateRef.current !== null) return;

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
      if (layerId === null) return; // persistError surfaced by the lifecycle hook

      layerIdRef.current = layerId;
      setActiveLayerId(layerId);
      seedRef.current = trimmed;
      setSeed(trimmed);
      turnsRef.current = [seedTurn];
      setTurns(turnsRef.current);
      applyState(initial);
      void runLoop();
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

  const pause = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const next = planningSessionReducer(current, { type: "PAUSE" });
    if (next === current) return;
    // Supersede the loop FIRST so the aborted stream's settle is ignored.
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setDraft(null);
    applyState(next);
    await persistStatus({ status: next.status });
  }, [applyState, persistStatus]);

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
      const turnId = await appendLayerTurn(projectId, layerId, {
        author: "You",
        content: trimmed,
        role: "human",
      });
      if (turnId !== null) {
        pushTurn({
          id: turnId,
          author: "You",
          content: trimmed,
          role: "human",
          at: Date.now(),
        });
      }
    },
    [projectId, appendLayerTurn, pushTurn],
  );

  const transitionAndStop = useCallback(
    async (event: { type: "FORCE_CONVERGE" } | { type: "END" }) => {
      const current = stateRef.current;
      if (!current) return;
      const next = planningSessionReducer(current, event);
      if (next === current) return;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRunning(false);
      setDraft(null);
      applyState(next);
      await persistStatus({ status: next.status });
    },
    [applyState, persistStatus],
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

  const completeFinalize = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const next = planningSessionReducer(current, { type: "FINALIZE_DONE" });
    if (next === current) return;
    applyState(next);
    // Stamp the provenance link in the SAME write as the terminal status.
    await persistStatus({
      status: next.status,
      link: { type: "produced-manifest", at: Date.now() },
    });
  }, [applyState, persistStatus]);

  const cancelFinalize = useCallback(async () => {
    const current = stateRef.current;
    if (!current || current.status !== "finalizing") return;
    const next: PlanningSessionState = { ...current, status: "converged" };
    applyState(next);
    await persistStatus({ status: "converged" });
  }, [applyState, persistStatus]);

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
    completeFinalize,
    cancelFinalize,
  };
}
