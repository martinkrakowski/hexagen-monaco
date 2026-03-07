import type { IApplySemanticPatchPort } from '../ports/in/apply-semantic-patch.port';

export class ApplySemanticPatchUseCase {
  constructor(private readonly port: IApplySemanticPatchPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error('Semantic patch data cannot be null or undefined');
    }

    // Delegate actual patch application (AST transform, Monaco model update, etc.)
    // to infrastructure port
    const result = await this.port.apply(data);

    // Optional: post-processing, confidence scoring, undo-stack registration
    return result;
  }
}
