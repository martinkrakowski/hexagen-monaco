import type { ValidateSpecPort } from '../ports/in/validate-spec.port';

export class ValidateSpecUseCase implements ValidateSpecPort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
