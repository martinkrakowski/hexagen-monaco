import type { ReconciliationState } from "../../../domain/reconciliation-state.js";

export type ReconciliationPhase =
  | "pending"
  | "diffing"
  | "verdict"
  | "approved"
  | "rejected";

export interface PromoteStatePort {
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState;
}

export function isPromoteStatePort(port: unknown): port is PromoteStatePort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.promoteToPhase === "function";
}
