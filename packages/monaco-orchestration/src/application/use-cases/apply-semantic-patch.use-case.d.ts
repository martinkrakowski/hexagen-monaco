import type { ApplySemanticPatchPort } from '../ports/in/apply-semantic-patch.port';
export declare class ApplySemanticPatchUseCase {
    private readonly port;
    constructor(port: ApplySemanticPatchPort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=apply-semantic-patch.use-case.d.ts.map