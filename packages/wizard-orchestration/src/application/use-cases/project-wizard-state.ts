import type { ProjectWizardStatePort } from "../ports/out/project-wizard-state.port";

export class ProjectWizardStateUseCase {
  constructor(private readonly port: ProjectWizardStatePort) {}

  async execute(data: unknown): Promise<unknown> {
    // Boundary validation - application layer responsibility
    if (data === null || data === undefined) {
      throw new Error("Wizard state data cannot be null or undefined");
    }

    // Delegate actual state management / persistence to infrastructure port
    const result = await this.port.getCurrentState(data);

    // Optional: post-processing, domain mapping, invariants check
    return result;
  }
}
