import type { ReconciliationState } from "../../../domain/reconciliation-state.js";

export type ReconciliationPhase =
  | "pending"
  | "diffing"
  | "verdict"
  | "approved"
  | "rejected";

export interface PromoteStatePort {
  /**
   * @deprecated Use promoteToPhase() instead for explicit phase transitions.
   * This method is verdict-based and does not advance the state machine to approved/rejected.
   */
  promoteState(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState;
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState;
}

export function isPromoteStatePort(port: unknown): port is PromoteStatePort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return (
    typeof p.promoteState === "function" &&
    typeof p.promoteToPhase === "function"
  );
}
