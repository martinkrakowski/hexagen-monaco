export interface WizardCompletionSignalPort {
  onWizardComplete(wizardData: {
    projectId: string;
    manifestYaml: string;
    boundedContexts: unknown[];
  }): Promise<void>;
}