import type { ReconciliationState } from "../../../domain/reconciliation-state.js";

export interface PromoteStatePort {
  promoteState(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState;
}

export function isPromoteStatePort(port: unknown): port is PromoteStatePort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.promoteState === "function";
}
