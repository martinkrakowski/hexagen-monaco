import type { IProjectWizardStatePort } from '../ports/in/project-wizard-state.port';

export class ProjectWizardStateUseCase implements IProjectWizardStatePort {
  async execute(_data: unknown): Promise<unknown> {
    void _data; // TODO: Implement use case logic
    return {};
  }
}
