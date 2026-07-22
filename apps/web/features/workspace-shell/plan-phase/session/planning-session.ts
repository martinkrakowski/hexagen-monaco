import type { ProjectLayer, ProjectLayerTurn } from "@hexagen/shared";

/**
 * Pure state machine for a live brainstorm session (Phase 3 v1).
 *
 * Deliberately NOT LangGraph / no new deps: the lifecycle is a small typed
 * reducer the client loop (usePlanningSession) dispatches into after each
 * persisted turn. Keeping it pure makes every transition unit-testable without
 * streaming or storage.
 *
 * Lifecycle:
 *   proposing → critiquing → (converged | revising) ; revising ⇄ critiquing
 *   converged → finalizing → done
 *   awaiting-human ← round cap / stream error / explicit human pause
 *   done (END) reachable from anywhere non-terminal
 */

export type SessionStatus = NonNullable<ProjectLayer["status"]>;

export type ModelRole = "proposer" | "critic";

/** Why the session is parked in `awaiting-human`. */
export type AwaitReason = "cap-reached" | "error" | "paused";

export const DEFAULT_MAX_ROUNDS = 4;

/** Statuses in which the client loop drives a model turn. */
const ACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "proposing",
  "critiquing",
  "revising",
]);

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(["done"]);

export interface PlanningSessionState {
  readonly status: SessionStatus;
  /** 1-based; a round = one proposal (or revision) + one critique. */
  readonly round: number;
  readonly maxRounds: number;
  /** Which model role runs next when the loop is (re)started. */
  readonly nextRole: ModelRole;
  /** Set only while status === "awaiting-human". */
  readonly awaitReason?: AwaitReason;
  /** Set only for awaitReason === "error". */
  readonly errorMessage?: string;
  /** The active status to return to on RESUME (pause/error interrupts). */
  readonly resumeStatus?: Extract<
    SessionStatus,
    "proposing" | "critiquing" | "revising"
  >;
}

export type PlanningSessionEvent =
  /** A proposer/reviser turn was durably persisted. */
  | { readonly type: "PROPOSAL_DONE" }
  /** A critic turn was durably persisted, with its parsed verdict. */
  | {
      readonly type: "CRITIQUE_DONE";
      readonly verdict: "converged" | "continue";
    }
  /** Human paused the loop (any in-flight turn is aborted, not persisted). */
  | { readonly type: "PAUSE" }
  /** Human resumes from awaiting-human (re-runs the interrupted role). */
  | { readonly type: "RESUME" }
  /** Human forces convergence from any non-terminal state. */
  | { readonly type: "FORCE_CONVERGE" }
  /** Finalize (distill → manifest) kicked off from converged. */
  | { readonly type: "FINALIZE_START" }
  /** Finalize hand-off completed — session is done. */
  | { readonly type: "FINALIZE_DONE" }
  /** A model turn failed (network/stream/persist) — never a silent stall. */
  | { readonly type: "ERROR"; readonly message: string }
  /** Human ends the session — terminal from anywhere. */
  | { readonly type: "END" };

export function initialSessionState(
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): PlanningSessionState {
  return {
    status: "proposing",
    round: 1,
    maxRounds: maxRounds > 0 ? Math.floor(maxRounds) : DEFAULT_MAX_ROUNDS,
    nextRole: "proposer",
  };
}

/**
 * Rebuild a session state from a persisted layer (interrupted-session
 * recovery: the tab died mid-loop and the stored status is non-terminal).
 *
 * Round recovery: turns are stamped with the round they were PRODUCED in, but
 * `CRITIQUE_DONE(continue)` advances the in-memory round to k+1 while
 * persisting status `revising` atomically with the round-k critic turn — so a
 * persisted `revising` is one round AHEAD of the highest turn stamp. Without
 * the +1 the resumed reviser would re-stamp round k (ambiguous provenance)
 * and the cap check would run one round late (2 extra quota requests).
 */
export function sessionStateFromLayer(layer: {
  readonly status?: SessionStatus;
  readonly maxRounds?: number;
  readonly turns: ReadonlyArray<{
    readonly role?: ProjectLayerTurn["role"];
    readonly round?: number;
  }>;
}): PlanningSessionState {
  const maxRounds =
    layer.maxRounds !== undefined && layer.maxRounds > 0
      ? layer.maxRounds
      : DEFAULT_MAX_ROUNDS;
  const persistedRound = Math.max(1, ...layer.turns.map((t) => t.round ?? 0));
  const status = layer.status ?? "awaiting-human";
  const round = status === "revising" ? persistedRound + 1 : persistedRound;
  const base: PlanningSessionState = {
    status,
    round,
    maxRounds,
    nextRole: roleForStatus(status) ?? "proposer",
  };
  if (status === "finalizing") {
    // Interrupted mid-distill (tab died between beginFinalize's status write
    // and the hand-off). The distill is ONE stateless, re-runnable chat call,
    // so recover as converged — otherwise a fully converged session would be
    // permanently un-finalizable (no reducer event accepts `finalizing` from
    // a fresh mount).
    return { ...base, status: "converged", nextRole: "proposer" };
  }
  if (status === "awaiting-human") {
    // A stored awaiting-human carries no reason. A cap-park is derivable: it
    // is the ONLY transition that persists awaiting-human right after a
    // critic turn stamped at round >= maxRounds (pause/error during a critic
    // turn persist an ACTIVE status instead). Recovering it as cap-reached
    // keeps Resume's round-extension semantics (revising, round + 1) instead
    // of silently re-running the proposer at a stale round.
    const lastModelTurn = findLastTurn(
      layer.turns,
      (t) => t.role === "proposer" || t.role === "critic",
    );
    const capReached =
      lastModelTurn?.role === "critic" &&
      (lastModelTurn.round ?? 0) >= maxRounds;
    if (capReached) {
      return { ...base, awaitReason: "cap-reached", resumeStatus: "revising" };
    }
    // Otherwise treat as a plain pause so Resume re-runs the proposer side
    // (safe default: a duplicate proposal is recoverable; a skipped critique
    // verdict is not).
    return { ...base, awaitReason: "paused", resumeStatus: "proposing" };
  }
  if (ACTIVE_STATUSES.has(status)) {
    // Non-terminal ACTIVE status persisted but no loop running → interrupted.
    return {
      ...base,
      status: "awaiting-human",
      awaitReason: "paused",
      resumeStatus: status as "proposing" | "critiquing" | "revising",
      nextRole: roleForStatus(status) ?? "proposer",
    };
  }
  return base;
}

/** The model role that runs a turn in the given active status. */
export function roleForStatus(status: SessionStatus): ModelRole | null {
  switch (status) {
    case "proposing":
    case "revising":
      return "proposer";
    case "critiquing":
      return "critic";
    default:
      return null;
  }
}

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActive(status: SessionStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Pure transition function. Invalid events for the current status return the
 * SAME state reference (callers can detect ignored events by identity).
 */
export function planningSessionReducer(
  state: PlanningSessionState,
  event: PlanningSessionEvent,
): PlanningSessionState {
  const { status } = state;

  switch (event.type) {
    case "PROPOSAL_DONE": {
      if (status !== "proposing" && status !== "revising") return state;
      return clearAwait({ ...state, status: "critiquing", nextRole: "critic" });
    }

    case "CRITIQUE_DONE": {
      if (status !== "critiquing") return state;
      if (event.verdict === "converged") {
        return clearAwait({
          ...state,
          status: "converged",
          nextRole: "proposer",
        });
      }
      if (state.round >= state.maxRounds) {
        // Round cap: park for the human instead of burning quota forever.
        return {
          ...state,
          status: "awaiting-human",
          awaitReason: "cap-reached",
          errorMessage: undefined,
          // Resuming past the cap is an explicit human extension: continue
          // into the next revision round.
          resumeStatus: "revising",
          nextRole: "proposer",
        };
      }
      return clearAwait({
        ...state,
        status: "revising",
        round: state.round + 1,
        nextRole: "proposer",
      });
    }

    case "PAUSE": {
      if (!ACTIVE_STATUSES.has(status)) return state;
      return {
        ...state,
        status: "awaiting-human",
        awaitReason: "paused",
        errorMessage: undefined,
        resumeStatus: status as "proposing" | "critiquing" | "revising",
        nextRole: roleForStatus(status) ?? state.nextRole,
      };
    }

    case "RESUME": {
      if (status !== "awaiting-human") return state;
      const resumed = state.resumeStatus ?? "proposing";
      const next: PlanningSessionState = clearAwait({
        ...state,
        status: resumed,
        nextRole: roleForStatus(resumed) ?? "proposer",
      });
      // Resuming past the round cap extends the session by one round.
      return state.awaitReason === "cap-reached"
        ? { ...next, round: state.round + 1 }
        : next;
    }

    case "FORCE_CONVERGE": {
      if (
        isTerminal(status) ||
        status === "converged" ||
        status === "finalizing"
      )
        return state;
      return clearAwait({
        ...state,
        status: "converged",
        nextRole: "proposer",
      });
    }

    case "FINALIZE_START": {
      if (status !== "converged") return state;
      return { ...state, status: "finalizing" };
    }

    case "FINALIZE_DONE": {
      if (status !== "finalizing") return state;
      return { ...state, status: "done" };
    }

    case "ERROR": {
      if (isTerminal(status)) return state;
      return {
        ...state,
        status: "awaiting-human",
        awaitReason: "error",
        errorMessage: event.message,
        resumeStatus: ACTIVE_STATUSES.has(status)
          ? (status as "proposing" | "critiquing" | "revising")
          : (state.resumeStatus ?? "proposing"),
        nextRole: roleForStatus(status) ?? state.nextRole,
      };
    }

    case "END": {
      if (isTerminal(status)) return state;
      return clearAwait({ ...state, status: "done" });
    }
  }
}

function findLastTurn<T>(
  items: ReadonlyArray<T>,
  predicate: (item: T) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i];
  }
  return undefined;
}

function clearAwait(state: PlanningSessionState): PlanningSessionState {
  const { awaitReason, errorMessage, resumeStatus, ...rest } = state;
  void awaitReason;
  void errorMessage;
  void resumeStatus;
  return rest;
}
