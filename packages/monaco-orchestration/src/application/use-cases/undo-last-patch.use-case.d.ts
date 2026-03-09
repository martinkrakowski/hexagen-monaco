import type { IUndoLastPatchPort } from '../ports/in/undo-last-patch.port';
export declare class UndoLastPatchUseCase {
    private readonly port;
    constructor(port: IUndoLastPatchPort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=undo-last-patch.use-case.d.ts.map