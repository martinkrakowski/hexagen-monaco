import type { IProjectWizardController } from "@hexagen/wizard-orchestration";

export class WizardMultiContextFake implements IProjectWizardController {
  private _navigatedTo: number = 0;
  private _activeContextId: string = "";

  navigateToStep(stepIndex: number): void {
    this._navigatedTo = stepIndex;
  }

  setActiveContextId(contextId: string): void {
    this._activeContextId = contextId;
  }

  getLastNavigatedStep(): number {
    return this._navigatedTo;
  }

  getActiveContextId(): string {
    return this._activeContextId;
  }

  reset(): void {
    this._navigatedTo = 0;
    this._activeContextId = "";
  }
}
