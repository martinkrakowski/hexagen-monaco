import type { IUndoLastPatchPort } from '../ports/in/undo-last-patch.port';

export class UndoLastPatchUseCase implements IUndoLastPatchPort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
