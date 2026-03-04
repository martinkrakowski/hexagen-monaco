// Inbound port for UndoLastPatch
export interface IUndoLastPatchPort {
  execute(data: unknown): Promise<unknown>;
}
