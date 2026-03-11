import type { ProjectCurrentBufferStatePort } from '../ports/in/project-current-buffer-state.port';
export declare class ProjectCurrentBufferStateUseCase {
    private readonly port;
    constructor(port: ProjectCurrentBufferStatePort);
    execute(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=project-current-buffer-state.use-case.d.ts.map