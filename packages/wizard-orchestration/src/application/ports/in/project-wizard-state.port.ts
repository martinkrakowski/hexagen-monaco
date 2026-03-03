// Inbound port for ProjectWizardState
export interface IProjectWizardStatePort {
  execute(data: unknown): Promise<unknown>;
}
