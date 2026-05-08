import type { DomainModelId } from "@hexagen/local-llm/shared";

export interface ModelPreferences {
  hasEnabledLocalModels: boolean;
  lastModelId: DomainModelId | null;
  autoLoadEnabled: boolean;
  cloudProvider: string | null;
  rememberApiKey: boolean;
  skipAiSetup: boolean;
  rememberChoice: boolean;
}

export interface ModelPreferencesPort {
  getPreferences(): ModelPreferences;
  setPreferences(preferences: Partial<ModelPreferences>): void;
}
