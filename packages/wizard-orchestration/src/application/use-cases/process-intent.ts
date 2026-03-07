import type { IProcessIntentPort } from '../ports/in/process-intent.port';

// If domain types already exist, import them here
// import { Intent } from '../../domain/entities/intent';
// import { IntentResult } from '../../domain/value-objects/intent-result';

export class ProcessIntentUseCase {
  constructor(private readonly port: IProcessIntentPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Step 1: Validate / convert incoming data to domain concept
    // For now we keep it generic until domain model is defined
    // Later: const intent = Intent.createFromRaw(data);

    if (!data) {
      throw new Error('Intent data cannot be empty');
    }

    // Step 2: Delegate to infrastructure port (real processing happens there)
    // Later: return this.port.process(intent);
    const result = await this.port.process(data);

    // Step 3: Optional post-processing / mapping back to domain result
    return result;
  }
}
