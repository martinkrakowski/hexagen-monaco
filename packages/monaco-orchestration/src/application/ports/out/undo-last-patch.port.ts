/**
 * Outbound (driven) port: undoes the last applied semantic patch (rollback
 * buffer state, restore previous version).
 *
 * Direction per ADR-0048: `UndoLastPatchUseCase` *depends on* this contract
 * (constructor injection, `src/application/use-cases/undo-last-patch.use-case.ts`)
 * and an infrastructure adapter (Monaco undo manager, patch-history store,
 * text-model snapshot) *implements* it. Depended-on by the use case and
 * implemented by an adapter is the definition of driven, hence `ports/out`
 * rather than `ports/in`.
 */
export interface UndoLastPatchPort {
  undo(data: unknown): Promise<unknown>;
}
