import type { IValidatePatchIntentPort } from '../ports/in/validate-patch-intent.port';
export declare class ValidatePatchIntentUseCase {
    private readonly port;
    constructor(port: IValidatePatchIntentPort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=validate-patch-intent.use-case.d.ts.map