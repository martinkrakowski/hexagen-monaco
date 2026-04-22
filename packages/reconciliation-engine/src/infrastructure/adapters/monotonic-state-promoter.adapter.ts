import type { PromoteStatePort } from "../../application/ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../domain/reconciliation-state.js";

export class MonotonicStatePromoterAdapter implements PromoteStatePort {
  promoteState(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState {
    // Ensure monotonic version increase
    if (state.version < 0) {
      throw new Error("Reconciliation state version cannot be negative");
    }

    // Ensure verdict exists in pending verdicts before promoting
    if (!state.pendingVerdicts.includes(verdictId)) {
      throw new Error(`Verdict ${verdictId} not found in pending verdicts`);
    }

    // Apply the promotion logic from domain function
    return {
      ...state,
      version: state.version + 1,
      lastUpdated: Date.now(),
      pendingVerdicts: state.pendingVerdicts.filter((id) => id !== verdictId),
      isStable: state.pendingVerdicts.length <= 1,
      conflictCount: Math.max(0, state.conflictCount - 1),
    };
  }
}
