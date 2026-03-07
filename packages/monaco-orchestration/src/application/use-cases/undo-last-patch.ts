import type { IUndoLastPatchPort } from '../ports/in/undo-last-patch.port';

export class UndoLastPatchUseCase {
  constructor(private readonly port: IUndoLastPatchPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error('Undo patch data cannot be null or undefined');
    }

    // Delegate actual undo operation (rollback last patch, restore buffer state)
    // to infrastructure port (Monaco undo manager, patch history adapter, etc.)
    const result = await this.port.undo(data);

    // Optional: post-processing, confirmation, telemetry
    return result;
  }
}
