import type { IValidateStepPort } from '../ports/in/validate-step.port';

export class ValidateStepUseCase implements IValidateStepPort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
