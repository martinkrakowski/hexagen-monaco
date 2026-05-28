export interface TandemConfig {
  enabled: boolean;
  localModelId: string;
  refinementEngine: "ENV" | "BYOK" | string;
  displayPreference: "overwrite" | "append";
  stageOneTimeoutSeconds: number;
  memoryHeadroomMB: number;
  promptTemplateVersion: string;
  firstTimeExperienceDismissed: boolean;
  autoRetryEnabled: boolean;
  lastValidatedAt: string; // ISO8601 timestamp
}

export const DEFAULT_TANDEM_CONFIG: TandemConfig = {
  enabled: false,
  localModelId: "",
  refinementEngine: "ENV",
  displayPreference: "overwrite",
  stageOneTimeoutSeconds: 60,
  memoryHeadroomMB: 4096, // Default to 4GB in MB
  promptTemplateVersion: "v1",
  firstTimeExperienceDismissed: false,
  autoRetryEnabled: true,
  lastValidatedAt: "",
};
