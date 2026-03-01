import type { IGenerateProjectPort } from '../ports/in/generate-project.port';

export class GenerateProjectUseCase implements IGenerateProjectPort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
