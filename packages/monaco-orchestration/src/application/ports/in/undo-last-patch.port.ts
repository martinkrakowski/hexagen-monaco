export interface IUndoLastPatchPort {
  /**
   * Undoes the last applied semantic patch (rollback buffer state, restore previous version).
   * Infrastructure adapters (Monaco undo manager, patch history store, text-model snapshot)
   * implement this contract.
   */
  undo(data: unknown): Promise<unknown>;
}
