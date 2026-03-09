import type { IProjectCurrentBufferStatePort } from '../ports/in/project-current-buffer-state.port';
export declare class ProjectCurrentBufferStateUseCase {
    private readonly port;
    constructor(port: IProjectCurrentBufferStatePort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=project-current-buffer-state.use-case.d.ts.map