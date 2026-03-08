import type { WizardSession } from '../../../domain/model/wizard-session/wizard-session';

export interface IWizardSessionRepository {
  save(entity: WizardSession): Promise<WizardSession>;
  findById(_id: string): Promise<WizardSession | null>;
}
