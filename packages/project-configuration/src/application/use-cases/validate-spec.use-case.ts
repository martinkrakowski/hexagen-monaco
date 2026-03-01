import type { IValidateSpecPort } from '../ports/in/validate-spec.port';

export class ValidateSpecUseCase implements IValidateSpecPort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
