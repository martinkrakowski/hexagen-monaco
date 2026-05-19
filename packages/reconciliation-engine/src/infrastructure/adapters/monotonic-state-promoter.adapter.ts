import type {
  PromoteStatePort,
  ReconciliationPhase,
} from "../../application/ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../domain/reconciliation-state.js";

/**
 * Monotonic State Promoter Adapter
 *
 * Manages monotonic (one-way) transitions of reconciliation state through phases:
 * pending → diffing → verdict → approved → rejected
 *
 * Key guarantees:
 * - State transitions are unidirectional and irreversible
 * - Version increments on every phase transition
 * - Pending verdicts track state during verdict phase
 * - Reaching approved phase clears all pending verdicts
 */
export class MonotonicStatePromoterAdapter implements PromoteStatePort {
  /**
   * Promote state to a target phase
   *
   * @param state - Current reconciliation state
   * @param targetPhase - Target phase to transition to
   * @returns Updated reconciliation state with incremented version and updated timestamp
   */
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState {
    // Validate monotonic progression
    if (!this.isValidTransition(state, targetPhase)) {
      // Return unchanged state if invalid transition
      return state;
    }

    const updatedState: ReconciliationState = {
      ...state,
      version: state.version + 1,
      lastUpdated: Date.now(),
    };

    // Apply phase-specific state mutations
    switch (targetPhase) {
      case "approved":
        updatedState.isStable = true;
        updatedState.pendingVerdicts = [];
        updatedState.conflictCount = 0;
        break;

      case "rejected":
        updatedState.isStable = false;
        updatedState.pendingVerdicts = [];
        break;

      case "verdict":
        updatedState.isStable = false;
        break;

      case "diffing":
        updatedState.isStable = false;
        break;

      case "pending":
        // No state mutation for pending (shouldn't be reached if monotonic)
        break;
    }

    return updatedState;
  }

  /**
   * Add a pending verdict to the state
   *
   * Transitions to verdict phase by tracking verdicts awaiting decision
   *
   * @param state - Current reconciliation state
   * @param verdictId - ID of the verdict to add
   * @returns Updated state with new pending verdict
   */
  addPendingVerdict(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState {
    // Avoid duplicates
    if (state.pendingVerdicts.includes(verdictId)) {
      return state;
    }

    return {
      ...state,
      version: state.version + 1,
      lastUpdated: Date.now(),
      pendingVerdicts: [...state.pendingVerdicts, verdictId],
      isStable: false,
      conflictCount: state.conflictCount + 1,
    };
  }

  /**
   * Validate that a phase transition is monotonic
   *
   * Ensures state transitions follow the allowed progression:
   * pending → diffing → verdict → (approved | rejected)
   *
   * @param state - Current reconciliation state
   * @param targetPhase - Target phase to transition to
   * @returns true if transition is allowed, false otherwise
   */
  private isValidTransition(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): boolean {
    // Phases in progression order
    const phaseOrder: ReconciliationPhase[] = [
      "pending",
      "diffing",
      "verdict",
      "approved",
    ];

    // Special case: rejected can be reached from verdict
    const currentPhaseIndex = phaseOrder.indexOf(
      this.getCurrentPhaseFromState(state),
    );
    const targetPhaseIndex = phaseOrder.indexOf(targetPhase);

    // Allow approved/rejected as terminal phases
    if (targetPhase === "approved" || targetPhase === "rejected") {
      return currentPhaseIndex >= phaseOrder.indexOf("verdict");
    }

    // For forward phases, target must be ahead of current
    return targetPhaseIndex > currentPhaseIndex;
  }

  /**
   * Infer current phase from state characteristics
   *
   * @param state - Reconciliation state to analyze
   * @returns Inferred current phase
   */
  private getCurrentPhaseFromState(state: ReconciliationState): ReconciliationPhase {
    if (state.isStable && state.pendingVerdicts.length === 0) {
      return "approved"; // or could be initial pending if version is 0
    }

    if (state.pendingVerdicts.length > 0) {
      return "verdict";
    }

    if (state.version > 0 && !state.isStable) {
      return "diffing";
    }

    return "pending";
  }
}
