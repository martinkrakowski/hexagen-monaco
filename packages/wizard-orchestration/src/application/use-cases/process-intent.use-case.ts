import type { IProcessIntentPort } from '../ports/in/process-intent.port';

export class ProcessIntentUseCase {
  constructor(private readonly port: IProcessIntentPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation (application layer responsibility)
    if (!data) {
      throw new Error('Intent data cannot be empty');
    }

    // Delegate to infrastructure port (AI engine, state machine, etc.)
    const result = await this.port.process(data);

    // Optional post-processing / mapping back to domain result
    return result;
  }
}
