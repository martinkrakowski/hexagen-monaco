import type { IValidatePatchIntentPort } from '../ports/in/validate-patch-intent.port';

export class ValidatePatchIntentUseCase {
  constructor(private readonly port: IValidatePatchIntentPort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error(
        'Patch intent validation data cannot be null or undefined'
      );
    }

    // Delegate actual validation (schema, business rules, invariants, safety checks)
    // to infrastructure port (Zod schema adapter, business-rules engine, etc.)
    const result = await this.port.validate(data);

    // Optional: post-processing, error enrichment, confidence scoring
    return result;
  }
}
