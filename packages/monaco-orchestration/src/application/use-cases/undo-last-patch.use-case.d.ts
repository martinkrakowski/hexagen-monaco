import type { UndoLastPatchPort } from '../ports/in/undo-last-patch.port';
export declare class UndoLastPatchUseCase {
    private readonly port;
    constructor(port: UndoLastPatchPort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=undo-last-patch.use-case.d.ts.map