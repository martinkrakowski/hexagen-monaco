import type { PromoteStatePort } from "../../application/ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../domain/reconciliation-state.js";
import { addVerdict, promoteState } from "../../domain/reconciliation-state.js";

type ReconciliationPhase =
  | "pending"
  | "diffing"
  | "verdict"
  | "approved"
  | "rejected";

const PHASE_ORDER: ReconciliationPhase[] = [
  "pending",
  "diffing",
  "verdict",
  "approved",
  "rejected",
];

const PHASE_RANK = new Map<ReconciliationPhase, number>(
  PHASE_ORDER.map((phase, index) => [phase, index]),
);

export class MonotonicStatePromoterAdapter implements PromoteStatePort {
  promoteState(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState {
    const currentPhase = this.inferPhase(state);

    if (currentPhase === "approved" || currentPhase === "rejected") {
      return state;
    }

    return promoteState(state, verdictId);
  }

  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState {
    const currentPhase = this.inferPhase(state);
    const currentRank = PHASE_RANK.get(currentPhase) ?? 0;
    const targetRank = PHASE_RANK.get(targetPhase) ?? 0;

    if (targetRank <= currentRank) {
      return state;
    }

    return {
      ...state,
      version: state.version + 1,
      lastUpdated: Date.now(),
      isStable: targetPhase === "approved" || targetPhase === "rejected",
    };
  }

  addPendingVerdict(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState {
    return addVerdict(state, verdictId);
  }

  private inferPhase(state: ReconciliationState): ReconciliationPhase {
    if (state.pendingVerdicts.length === 0 && state.isStable) {
      return state.conflictCount === 0 ? "approved" : "rejected";
    }
    if (state.pendingVerdicts.length > 0) {
      return "verdict";
    }
    if (state.version > 0 && state.pendingVerdicts.length === 0) {
      return "diffing";
    }
    return "pending";
  }
}
