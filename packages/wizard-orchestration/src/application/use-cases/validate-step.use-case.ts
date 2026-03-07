import type { IValidateStepPort } from '../ports/in/validate-step.port';

export class ValidateStepUseCase {
  constructor(private readonly port: IValidateStepPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error('Step validation data cannot be null or undefined');
    }

    // Delegate actual validation (schema, business rules, invariants) to infrastructure port
    const result = await this.port.validate(data);

    // Optional: post-processing, domain mapping, error enrichment
    return result;
  }
}
