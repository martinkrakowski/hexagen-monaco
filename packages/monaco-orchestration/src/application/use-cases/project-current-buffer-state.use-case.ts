import type { IProjectCurrentBufferStatePort } from '../ports/in/project-current-buffer-state.port';

export class ProjectCurrentBufferStateUseCase implements IProjectCurrentBufferStatePort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
