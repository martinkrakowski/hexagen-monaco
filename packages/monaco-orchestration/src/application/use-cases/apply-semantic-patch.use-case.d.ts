import type { IApplySemanticPatchPort } from '../ports/in/apply-semantic-patch.port';
export declare class ApplySemanticPatchUseCase {
    private readonly port;
    constructor(port: IApplySemanticPatchPort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=apply-semantic-patch.use-case.d.ts.map