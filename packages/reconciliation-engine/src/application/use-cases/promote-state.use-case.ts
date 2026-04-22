import type { PromoteStatePort } from "../ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../domain/reconciliation-state.js";

export class PromoteStateUseCase {
  constructor(private readonly promoteStatePort: PromoteStatePort) {}

  execute(state: ReconciliationState, verdictId: string): ReconciliationState {
    return this.promoteStatePort.promoteState(state, verdictId);
  }
}
