import type { IProjectCurrentBufferStatePort } from '../ports/in/project-current-buffer-state.port';

export class ProjectCurrentBufferStateUseCase {
  constructor(private readonly port: IProjectCurrentBufferStatePort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error('Buffer state query data cannot be null or undefined');
    }

    // Delegate actual buffer state retrieval (current Monaco model content, cursor, etc.)
    // to infrastructure port (Monaco editor adapter, snapshot service, etc.)
    const result = await this.port.getCurrentState(data);

    // Optional: post-processing, serialization, domain mapping
    return result;
  }
}
